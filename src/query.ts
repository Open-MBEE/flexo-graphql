// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./rdfjs.d.ts" />

import type {Dict, JsonObject, JsonValue} from '@blake.regalia/belt';
import type {Literal, Quad, Quad_Object, Quad_Predicate, Quad_Subject} from '@rdfjs/types';
import type {FieldNode, InlineFragmentNode, ValueNode} from 'graphql';

import type {Pattern} from 'sparqljs';

import {proper} from '@blake.regalia/belt';
import {default as factory} from '@rdfjs/data-model';
import {Kind, parse, visit} from 'graphql';

import {P_NS_BASE, type BinderStruct, type SparqlPlan, P_NS_DEF, G_RDF_TYPE, P_NS_XSD} from './share';


interface TermNode extends FieldNode {
	term: Quad_Subject;
}

interface TermFragment extends InlineFragmentNode {
	term: Quad_Subject;
}

const h_binary_operators: Dict = {
	eq: '=',
	neq: '!=',
	gt: '>',
	lt: '<',
	gte: '>=',
	lte: '<=',
	equals: '=',
	notEquals: '!=',
	equalTo: '=',
	notEqualTo: '!=',
	greaterThan: '>',
	lessThan: '<',
	lesserThan: '<',
	greaterThanOrEqualTo: '>=',
	lessThanOrEqualTo: '<=',
	lesserThanOrEqualTo: '<=',

	startsWith: 'strStarts',
	endsWith: 'strEnds',
	regex: 'contains',
};


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

export function graphql_query_to_sparql_plan(sx_query: string): SparqlPlan {
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
	const a_stack: any[] = [];

	// parse query
	const y_doc = parse(sx_query);

	// visit ast
	visit(y_doc, {
		// each field
		[Kind.FIELD]: {
			// pop when leaving
			leave() {
				h_node = a_stack.pop();
			},

			// when entering...
			enter(yn_field, si_key, z_parent, a_path, a_ancestors) {
				// field name
				const si_field = yn_field.name.value;

				// alias
				const si_label = yn_field.alias?.value || si_field;

				// ref arguments
				const a_arguments = yn_field.arguments;

				// prep descriptor object
				const h_descriptor: JsonObject = {};

				// self node reference (defaults to descriptor object)
				h_node[si_label] = h_descriptor;

				// root-level selector
				if(a_ancestors.length <= 4) {
					// prep plurality flag
					let b_plural = false;

					// is plural
					if(si_field.endsWith('s')) {
						b_plural = true;

						// wrap in array annotation
						h_node[si_label] = [h_descriptor];
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

					// save subject term to ast node
					(yn_field as TermNode).term = g_subject;

					// derive class
					const si_type = proper(b_plural? si_field.replace(/s$/, ''): si_field);
					const g_type = factory.namedNode(P_NS_DEF+si_type);

					// create triple pattern
					const g_triple = factory.quad(g_subject, G_RDF_TYPE, g_type);

					// add to root bgp
					a_bgp.push(g_triple);

					// exit
					return;
				}

				// find closest field ancestor
				let g_subject!: Quad_Subject;
				for(let i_ancestor=a_ancestors.length-1; i_ancestor>=0; i_ancestor--) {
					const w_ancestor = a_ancestors[i_ancestor] as TermNode | TermFragment;

					// field
					if(Kind.FIELD === w_ancestor.kind || Kind.INLINE_FRAGMENT === w_ancestor.kind) {
						// select it as subject node
						g_subject = w_ancestor.term;

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
				if('__any' === si_field) {
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
				}
				// not variable
				else {
					// symbol
					const si_symbol = next_symbol(si_label);

					// create resolved target
					g_target = factory.variable!(`${si_symbol}_${a_selections || a_arguments?.length? 'node': 'value'}`);

					// save to ast node
					(yn_field as TermNode).term = g_target;

					// use as predicate
					let g_predicate: Quad_Predicate = factory.namedNode(`${P_NS_BASE}${si_field}`);

					// inverse
					if(yn_field.directives?.find(g_directive => 'inverse' === g_directive.name.value)) {
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

							// property edge
							const g_property = factory.namedNode(`${P_NS_BASE}${si_property}`);

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
								const si_operator = g_arg.name.value;

								// by binary comparison
								if(si_operator in h_binary_operators) {
									a_where.push({
										type: 'filter',
										expression: {
											type: 'operation',
											operator: h_binary_operators[si_operator],
											args: [
												g_target,
												graphql_value_to_rdfjs_term(g_arg.value),
											],
										},
									});
								}
								// using regex comparison
								else if('regex' === si_operator) {
									debugger;
									throw new Error(`Regex not yet implemented`);
									// a_where.push({
									// 	type: 'filter',
									// 	expression: {
									// 		type: 'operation',
									// 		operator: h_binary_operators[si_operator],
									// 		args: [
									// 			g_target,
									// 			graphql_value_to_rdfjs_term(g_arg.value),
									// 		],
									// 	},
									// });
								}
								// other
								else {
									throw new Error(`Unknown operator "${si_operator}"`);
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

							// create type node
							const g_type = factory.namedNode(`${P_NS_DEF}${si_frag_type}`);

							// add type triple pattern
							a_unions.push([
								factory.quad(g_target, G_RDF_TYPE, g_type),
							]);

							// set term on fragment
							(yn_sel as TermFragment).term = g_target;
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
	};
}


