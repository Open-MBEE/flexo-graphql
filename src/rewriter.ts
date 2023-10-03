// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./rdfjs.d.ts" />

import type {BinderStruct, SparqlPlan, EvalError} from './share.ts';
import type {Dict, JsonObject, JsonValue, Nilable} from 'npm:@blake.regalia/belt@^0.15.0';
import type {Literal, NamedNode, Quad, Quad_Object, Quad_Predicate, Quad_Subject} from 'npm:@rdfjs/types@^1.1.0';
import type {
	ConstDirectiveNode,
	DocumentNode,
	FieldDefinitionNode,
	FieldNode,
	FragmentDefinitionNode,
	InlineFragmentNode,
	InterfaceTypeDefinitionNode,
	ObjectTypeDefinitionNode,
	ValueNode,
} from 'npm:graphql@^16.8.0';
import type {Pattern} from 'npm:sparqljs@^3.7.1';

import {ode, proper} from 'npm:@blake.regalia/belt@^0.15.0';
import {default as factory} from 'npm:@rdfjs/data-model@^1.1.0';
import {Kind, parse, visit, BREAK} from 'npm:graphql@^16.8.0';
import {default as jsonld} from 'npm:jsonld@^8.2.0';

import {A_PRIMITIVES, P_NS_XSD} from './constants.ts';
import {G_RDF_TYPE} from './share.ts';
import {transform_skip_include} from './transform-skip-include.ts';
import {transform_variables} from './transform-variables.ts';

interface TermNode extends FieldNode {
	term: Quad_Subject;
	object: ObjectNode;
}

interface TermFragment extends InlineFragmentNode {
	term: Quad_Subject;
	object: ObjectNode;
}

const H_BINARY_OPERATORS: Dict = {
	is: '=',
	not: '!=',

	in: 'in',
	notIn: 'notin',

	// eq: '=',
	// neq: '!=',
	// gt: '>',
	// lt: '<',
	// gte: '>=',
	// lte: '<=',
	// equalTo: '=',
	// notEqualTo: '!=',
	// lesserThan: '<',
	// lesserThanOrEqualTo: '<=',

	equals: '=',
	notEquals: '!=',
	lessThan: '<',
	greaterThan: '>',
	lessThanOrEqualTo: '<=',
	greaterThanOrEqualTo: '>=',

	contains: 'contains',
	startsWith: 'strStarts',
	endsWith: 'strEnds',
	regex: 'regex',
};

export interface GraphqlRewriterConfig {
	/**
	 * GraphQL schema
	 */
	schema: string;

	/**
	 * JSON-LD context for mapping graphql fields to IRIs
	 */
	context?: Nilable<Dict<string | {
		'@type': '@id';
		'@id': string;
	}>>;

	/**
	 * Base IRI for creating nodes
	 */
	base?: Nilable<string>;
}


interface TranslatedField {
	iri: string;
	type: 'boolean' | 'integer' | 'decimal' | 'string' | 'node' | 'unknown';
}

type JsonLdNode = {
	'@value'?: string;
	'@id'?: string;
	'@type'?: string[];
};


const H_JSON_LD_TYPES_MAP = {
	'@id': 'node',
	[P_NS_XSD+'boolean']: 'boolean',
	[P_NS_XSD+'integer']: 'integer',
	[P_NS_XSD+'decimal']: 'decimal',
	[P_NS_XSD+'string']: 'string',
} as const;

const H_GRAPHQL_KINDS_MAP = {
	[Kind.BOOLEAN]: 'boolean',
	[Kind.INT]: 'integer',
	[Kind.FLOAT]: 'decimal',
	[Kind.STRING]: 'string',
};



function translate_expanded_node_def(si_key: string, g_node: JsonLdNode): TranslatedField {
	// simple string
	if('string' === typeof g_node['@value']) {
		return {
			iri: g_node['@value'],
			type: 'unknown',
		};
	}
	// other
	else {
		// ref iri property
		const p_iri = g_node['@id']!;

		// not a singular type
		if(1 !== g_node['@type']?.length) {
			throw new Error(`Resolved JSON-LD key definition not allowed to have more than one type: "${si_key}": ${g_node['@type']}`);
		}

		// ref type
		const s_type = g_node['@type'][0]+'';

		// resolve type
		const s_type_mapped = H_JSON_LD_TYPES_MAP[s_type];

		// type not defined in mapping
		if(!s_type_mapped) {
			throw new Error(`Resolved JSON-LD type not supported: ${s_type}`);
		}

		// fully translated
		return {
			iri: p_iri,
			type: s_type_mapped,
		};
	}
}

interface ObjectNode {
	label: string;
	fields: Dict<FieldDefinitionNode>;
	directives: Dict<ConstDirectiveNode>;
}

export class GraphqlRewriter {
	static create(gc_rewriter: GraphqlRewriterConfig): Promise<GraphqlRewriter> {
		return new GraphqlRewriter(gc_rewriter).init();
	}

	protected _y_doc: DocumentNode;

	protected _h_context: GraphqlRewriterConfig['context'];
	protected _p_base: GraphqlRewriterConfig['base'];

	// prep context mapping cache
	protected _h_cache: Dict<TranslatedField> = {};

	protected _h_types: Dict<ObjectNode> = {};

	constructor(gc_rewriter: GraphqlRewriterConfig) {
		this._y_doc = parse(gc_rewriter.schema);
		this._h_context = gc_rewriter.context;
		this._p_base = gc_rewriter.base;

		// map type defs
		const h_types = this._h_types;
		for(const g_def of this._y_doc.definitions) {
			if([Kind.OBJECT_TYPE_DEFINITION, Kind.INTERFACE_TYPE_DEFINITION].includes(g_def.kind)) {
				const g_def_union = g_def as ObjectTypeDefinitionNode | InterfaceTypeDefinitionNode;

				const h_fields: Dict<FieldDefinitionNode> = {};
				for(const g_field of g_def_union.fields || []) {
					h_fields[g_field.name.value] = g_field;
				}

				const h_directives: Dict<ConstDirectiveNode> = {};
				for(const g_directive of g_def_union.directives || []) {
					h_directives[g_directive.name.value] = g_directive;
				}

				const si_label = g_def_union.name.value;
				h_types[si_label] = {
					label: si_label,
					fields: h_fields,
					directives: h_directives,
				};
			}
		}
	}

	async init(): Promise<this> {
		const {_h_context, _h_cache} = this;

		// using context
		if(_h_context) {
			// create a complete dummy document for json-ld to be able to expand it
			for(const [si_key, w_value] of ode(_h_context)) {
				// expand a dummy document using the id
				const a_expanded = await jsonld.expand({
					'@context': _h_context,
					[si_key]: w_value,
				});

				// ref expanded node def
				const h_doc = a_expanded[0];

				// translate it
				_h_cache[si_key] = translate_expanded_node_def(si_key, (Object.values(h_doc)[0] as JsonLdNode[])[0]);
			}
		}
		// no base found
		else if(!this._p_base) {
			throw new Error(`Must supply one of 'context' or 'base' to GraphqlRewriter constructor options argument`);
		}

		return this;
	}

	translate(si_key: string): TranslatedField {
		const {_h_context, _h_cache, _p_base} = this;

		// context defined
		if(_h_context) {
			// key not found in cache
			if(!(si_key in _h_cache)) {
				throw new Error(`No such field key "${si_key}"`);
			}

			// return cached entry
			return _h_cache[si_key];
		}
		// no context defined; derive from base
		else if(_p_base) {
			return {
				iri: _p_base+si_key,
				type: 'unknown',
			};
		}
		// neither defined
		else {
			throw new Error(`Unable to translate graphql key`);
		}
	}

	node(si_key: string) {
		return factory.namedNode(this.translate(si_key).iri);
	}

	rewrite(sx_query: string, h_variables: Dict<unknown>): SparqlPlan {
		const {_h_types} = this;
		const h_queries = _h_types['Query'].fields;

		// deno-lint-ignore no-this-alias
		const k_self = this;

		// errors
		const a_errors: EvalError[] = [];
		function exit(s_err: string): typeof BREAK {
			a_errors.push({
				message: s_err,
			});
			return BREAK;
		}

		// symbol issuer for disambiguating labels
		const h_symbols: Dict<number> = {};
		function next_symbol(s_req: string): string {
			const nl_disambig = h_symbols[s_req] = h_symbols[s_req]? h_symbols[s_req] + 1: 1;

			return nl_disambig > 1? `${s_req}_${nl_disambig}`: s_req;
		}

		// bgp for patterns
		const a_root_bgp: Quad[] = [];
		const a_bgp = a_root_bgp;

		const a_where: Pattern[] = [{
			type: 'bgp',
			triples: a_bgp,
		}];

		// prep struct for mapping result bindings
		const h_root: BinderStruct = {};

		// init floating node pointer
		let h_node: Dict<JsonValue> = h_root;

		// prep node stack
		const a_stack: Dict<JsonValue>[] = [];

		// parse query
		let y_doc = parse(sx_query);

		// inline fragments
		{
			const h_fragments: Dict<FragmentDefinitionNode> = {};

			// build lookup of fragments by name and remove them from ast
			y_doc = visit(y_doc, {
				[Kind.FRAGMENT_DEFINITION]: {
					enter(yn_frag) {
						// save def to lookup
						h_fragments[yn_frag.name.value] = yn_frag;

						// delete fragment def from ast
						return null;
					},
				},
			});

			// replace spreads of named fragments with their contents
			y_doc = visit(y_doc, {
				[Kind.FRAGMENT_SPREAD]: {
					enter(yn_spread) {
						const si_frag = yn_spread.name.value;

						// locate fragment
						const yn_frag = h_fragments[si_frag];

						// not found
						if(!yn_frag) return exit(`No such fragment was defined in query: "${si_frag}"`);

						// replace with selection set
						return {
							...yn_frag.selectionSet,
						};
					},
				},
			});
		}

		// substitute variables
		y_doc = transform_variables(y_doc, exit, h_variables);

		// apply @skip and @include directives
		y_doc = transform_skip_include(y_doc, exit);

		// visit ast
		visit(y_doc, {
			// each field
			[Kind.FIELD]: {
				// pop when leaving
				leave() {
					h_node = a_stack.pop()!;
				},

				// when entering...
				enter(yn_field, si_key, z_parent, a_path, a_ancestors) {
					// field name
					const si_field = yn_field.name.value;

					// alias
					const si_label = yn_field.alias?.value || si_field;

					// ref arguments
					const a_arguments = yn_field.arguments;

					// type check arguments
					for(const g_arg of a_arguments || []) {
						// ref argument name
						const si_arg = g_arg.name.value;

						// translate
						let p_iri: string;
						let s_type_expected: string;
						try {
							({
								iri: p_iri,
								type: s_type_expected,
							} = k_self.translate(si_arg));
						}
						catch(e_translate) {
							return exit((e_translate as Error).message);
						}

						// node is not allowed
						if('node' === s_type_expected) {
							return exit(`Cannot use '${si_arg}' as a parameter since its corresponding value type is a node`);
						}
						// not unknown
						else if('unknown' !== s_type_expected) {
							// ref value
							const g_value = g_arg.value;

							// ref kind
							const si_kind = g_value.kind;

							// a primitive type
							const s_type_actual = H_GRAPHQL_KINDS_MAP[si_kind as keyof typeof H_GRAPHQL_KINDS_MAP];
							if(s_type_actual) {
								// types do not match
								if(s_type_actual !== s_type_expected) {
									return exit(`Value passed to parameter '${si_arg}' is of type ${s_type_actual}, but that predicate expects a type of ${s_type_expected}`);
								}
							}
							// null, enum, list, object, or variable
							else {
								return exit(`Value passed to parameter '${si_arg}' is of kind ${si_kind}, but that kind is not yet supported`);
							}
						}
					}

					// prep descriptor object
					const h_descriptor: JsonObject = {};

					// self node reference (defaults to descriptor object)
					h_node[si_label] = h_descriptor;

					// root-level selector
					if(a_ancestors.length <= 4) {
						// prep plurality flag
						let b_plural = false;

						// find in schema
						const g_def = h_queries[si_field];

						// not found
						if(!g_def) {
							return exit(`No such root query "${si_field}". Expected one of: [${Object.keys(h_queries).map(s => `"${s}"`).join(', ')}]`);
						}

						// ref type def node
						let g_def_type = g_def.type;

						// unwrap non-null type
						if(Kind.NON_NULL_TYPE === g_def_type.kind) g_def_type = g_def_type.type;

						// is list
						if(Kind.LIST_TYPE === g_def_type.kind) {
							b_plural = true;

							// wrap descriptor in array annotation
							h_node[si_label] = [h_descriptor];

							// unwrap list
							g_def_type = g_def_type.type;

							// unwrap non-null type
							if(Kind.NON_NULL_TYPE === g_def_type.kind) g_def_type = g_def_type.type;
						}

						// should be named type
						if(Kind.NAMED_TYPE !== g_def_type.kind) {
							return exit(`Unable to process root type definition node in Query object type for key '${si_field}'`);
						}

						// ref field type name
						const si_field_type = g_def_type.name.value;

						// not found
						const g_object_type = _h_types[si_field_type];
						if(!g_object_type) {
							return exit(`Fatal error; no type definition was found for ${si_field_type}`);
						}

						// symbol
						const si_symbol = next_symbol(`${si_label}_node`);

						// subject node
						const g_subject = factory.variable!(si_symbol);

						// save to descriptor
						h_descriptor['$iri'] = si_symbol;

						// push current node to stack
						a_stack.push(h_node);

						// set descriptor as new node
						h_node = h_descriptor;

						// save subject term and object node to ast node
						Object.assign(yn_field as TermNode, {
							term: g_subject,
							object: g_object_type,
						});

						// derive class
						const si_type = proper(b_plural? si_field.replace(/s$/, ''): si_field);
						let g_type: NamedNode<string>;
						try {
							g_type = k_self.node(si_type);
						}
						catch(e_node) {
							return exit((e_node as Error).message);
						}

						// create triple pattern
						const g_triple = factory.quad(g_subject, G_RDF_TYPE, g_type);

						// add to root bgp
						a_bgp.push(g_triple);

						// exit
						return;
					}

					// find closest field ancestor
					let g_subject!: Quad_Subject;
					let g_object_type!: ObjectNode | null;
					for(let i_ancestor=a_ancestors.length-1; i_ancestor>=0; i_ancestor--) {
						const w_ancestor = a_ancestors[i_ancestor] as TermNode | TermFragment;

						// field
						if(Kind.FIELD === w_ancestor.kind || Kind.INLINE_FRAGMENT === w_ancestor.kind) {
							// select it as subject node
							g_subject = w_ancestor.term;

							// update object type
							g_object_type = (w_ancestor as TermNode).object || null;

							// take closest
							break;
						}
					}

					// no subject
					if(!g_subject) {
						debugger;
						throw new Error(`Missing subject node`);
					}


					// push current node to stack
					a_stack.push(h_node);

					// set descriptor as new node
					h_node = h_descriptor;

					// ref node's selection set property
					const a_selections = yn_field.selectionSet?.selections;

					// // variable predicate
					// if(yn_field.directives?.find(g_directive => 'var' === g_directive.name.value)) {

					let g_target!: Quad_Subject;

					// variable predicate
					if('_any' === si_field) {
						// symbol
						const si_symbol = next_symbol(yn_field.alias?.value || 'any');

						// create predicate var
						const g_predicate = factory.variable!(`${si_symbol}_any`);

						// resolved object
						g_target = factory.variable!(`${si_symbol}_node`);

						// create property triple pattern
						const g_property = factory.quad(g_subject, g_predicate, g_target);

						// add to bgp
						a_bgp.push(g_property);

						// save to descriptor
						h_descriptor['$any'] = g_predicate.value;
						h_descriptor['$iri'] = g_target.value;

						// save to ast node
						(yn_field as TermNode).term = g_target;
					}
					// reserved __typename
					else if('__typename' === si_field) {
						// resolved object
						g_target = factory.variable!(`${g_subject.value}_typename`);

						// create property triple pattern
						const g_property = factory.quad(g_subject, G_RDF_TYPE, g_target);

						// add to bgp
						a_bgp.push(g_property);

						// save to descriptor
						a_stack.at(-1)['__typename'] = g_target.value;
					}
					// not variable
					else {
						// // whether or not the inverse directive is applied
						// const b_inverse = yn_field.directives?.find(g_directive => 'inverse' === g_directive.name.value);

						// inverse relation; normalize
						const b_inverse = si_field.startsWith('_inv_');

						// type-check property on object
						let g_reference_type!: ObjectNode;
						if(g_object_type) {
							const g_object_field_def = g_object_type.fields[si_field];

							// no property found
							if(!g_object_field_def) {
								return exit(`No such property "${si_field}" defined on ${g_object_type.label} object type`);
							}

							const si_object_subtype = (g_object_field_def.type as {name?: {value: string}})?.name?.value;

							// not a primitive type
							if(si_object_subtype && !A_PRIMITIVES.includes(si_object_subtype)) {
								g_reference_type = _h_types[si_object_subtype];
							}
						}

						// symbol
						const si_symbol = next_symbol(si_label);

						// create resolved target
						g_target = factory.variable!(`${si_symbol}_${a_selections || a_arguments?.length? 'node': 'value'}`);

						// save to ast node
						(yn_field as TermNode).term = g_target;

						// use as predicate
						let g_predicate: Quad_Predicate;
						try {
							g_predicate = k_self.node(b_inverse? si_field.replace(/^_inv_/, ''): si_field);
						}
						catch(e_node) {
							return exit((e_node as Error).message);
						}

						// inverse
						if(b_inverse) {
							g_predicate = {
								type: 'path',
								pathType: '^',
								items: [g_predicate],
							} as unknown as Quad_Predicate;
						}

						// create triple pattern
						const g_triple = factory.quad(g_subject, g_predicate, g_target);

						// add to context
						a_bgp.push(g_triple);

						// many
						if(yn_field.directives?.find(g_directive => 'many' === g_directive.name.value)) {
							// wrap in array annotation
							a_stack.at(-1)[si_label] = [h_descriptor];
						}


						// has arguments
						if(a_arguments?.length) {
							// save to descriptor as node
							h_descriptor['$iri'] = g_target.value;

							// each argument
							for(const yn_arg of a_arguments) {
								// property label
								const si_property = yn_arg.name.value;

								// an object type definition exists
								if(g_reference_type) {
									const g_field_type = g_reference_type.fields[si_property];

									// property not defined on object
									if(!g_field_type) {
										return exit(`No such property "${si_property}" defined on ${g_reference_type.label} object type`);
									}
								}

								// property edge
								let g_property: NamedNode;
								try {
									g_property = k_self.node(si_property);
								}
								catch(e_node) {
									return exit((e_node as Error).message);
								}

								// object node
								let g_value: Quad_Object;

								// property value type
								const yn_value = yn_arg.value;
								switch(yn_value.kind) {
									case Kind.STRING: {
										g_value = factory.literal(yn_value.value);
										break;
									}

									case Kind.BOOLEAN: {
										g_value = factory.literal(yn_value.value? 'true': 'false', `${P_NS_XSD}boolean`);
										break;
									}

									case Kind.INT: {
										g_value = factory.literal(yn_value.value, `${P_NS_XSD}integer`);
										break;
									}

									default: {
										debugger;
										throw new Error(`Unhandled argument value type`);
									}
								}

								// add pattern
								a_bgp.push(factory.quad(g_target, g_property, g_value));
							}
						}
						// no arguments; has selection set
						else if(a_selections) {
							h_node['$iri'] = g_target.value;
						}
						// terminal scalar value
						else {
							a_stack.at(-1)[si_label] = g_target.value;

							// uses `@filter` directive
							const gc_filter = yn_field.directives?.find(g => 'filter' === g.name.value);
							if(gc_filter) {
								for(const g_arg of gc_filter.arguments || []) {
									let si_operator = g_arg.name.value;

									// expression placeholder
									let g_expression: {
										type: 'operation';
										operator: string;
										args: any[];
									};

									// negation
									let b_negate = false;
									if(!(si_operator in H_BINARY_OPERATORS) && si_operator.startsWith('not')) {
										b_negate = true;
										si_operator = si_operator.replace(/^not(\w)/, (s_all, s_char) => s_char.toLowerCase());
									}

									// by binary comparison
									if(si_operator in H_BINARY_OPERATORS) {
										g_expression = {
											type: 'operation',
											operator: H_BINARY_OPERATORS[si_operator],
											args: [
												g_target,
												graphql_value_to_sparqljs_arg(g_arg.value),
											],
										};
									}
									// using regex comparison
									else if('regex' === si_operator) {
										// wrap variable in `str()` cast
										g_expression = {
											type: 'operation',
											operator: 'regex',
											args: [
												{
													type: 'operation',
													operator: 'str',
													args: [g_target],
												},
												graphql_value_to_sparqljs_arg(g_arg.value),
											],
										};
									}
									// other
									else {
										throw new Error(`Unknown operator "${si_operator}"`);
									}

									if(g_expression) {
										a_where.push({
											type: 'filter',
											expression: b_negate
												? {
													type: 'operation',
													operator: '!',
													args: [g_expression],
												}
												: g_expression,
										});
									}
								}
							}
						}
					}

					// has selections
					if(a_selections) {
						// prepare union
						const a_unions = [];

						// each selection
						for(const yn_sel of a_selections) {
							// uses inline fragment
							if(Kind.INLINE_FRAGMENT === yn_sel.kind) {
								// type label
								const si_frag_type = yn_sel.typeCondition?.name.value;

								// no type
								if(!si_frag_type) {
									return exit(`Inline fragment must specify a type condition`);
								}

								// create type node
								let g_type;
								try {
									g_type = k_self.node(si_frag_type);
								}
								catch(e_node) {
									return exit((e_node as Error).message);
								}

								// type not defined
								const g_object_subtype = _h_types[si_frag_type];
								if(!g_object_subtype) {
									return exit(`No such object type "${si_frag_type}" defined.`);
								}

								// add type triple pattern
								a_unions.push([
									factory.quad(g_target, G_RDF_TYPE, g_type),
								]);

								// set term and object type on fragment
								Object.assign(yn_sel as TermFragment, {
									term: g_target,
									object: g_object_subtype,
								});
							}
						}

						// combine unions
						if(1 === a_unions.length) {
							a_bgp.push(...a_unions[0]);
						}
						else if(a_unions.length > 1) {
							debugger;
							throw new Error(`Union of inline fragment types not yet implemented`);
						}
					}
				},
			},
		});

		return {
			where: a_where,
			shape: h_root,
			errors: a_errors,
		};
	}
}

function graphql_value_to_rdfjs_term(g_value: ValueNode): Literal {
	if(Kind.BOOLEAN === g_value.kind) {
		return factory.literal(g_value.value? 'true': 'false', `${P_NS_XSD}boolean`);
	}
	else if(Kind.INT === g_value.kind) {
		return factory.literal(g_value.value, `${P_NS_XSD}integer`);
	}
	else if(Kind.STRING === g_value.kind) {
		return factory.literal(g_value.value);
	}
	else {
		return factory.literal('void', 'void://null');
	}
}

interface NestedArray<w> {
	[i_index: number]: w | NestedArray<w>;
}

type NestedArrayable<w> = NestedArray<w> | w;

function graphql_value_to_sparqljs_arg(g_value: ValueNode): NestedArrayable<Literal> {
	if(Kind.LIST === g_value.kind) {
		return g_value.values.map(graphql_value_to_sparqljs_arg);
	}
	else {
		return graphql_value_to_rdfjs_term(g_value);
	}
}
