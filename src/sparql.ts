import type {BinderStruct, EvalError, SparqlPlan} from './share.ts';
import type {Dict, JsonObject, JsonValue} from 'npm:@blake.regalia/belt@^0.15.0';

import {ode} from 'npm:@blake.regalia/belt@^0.15.0';
import {default as sparqljs} from 'npm:sparqljs@3.7.1';

import {P_NS_BASE, P_NS_DEF, P_NS_RDF, P_NS_XSD} from './constants.ts';


type SparqlBinding = Dict<{
	type: 'uri';
	value: string;
} | {
	type: 'literal';
	value: string;
	datatype?: string;
	'xml:lang'?: string;
}>;


const h_prefixes = {
	'': P_NS_BASE,
	'def': P_NS_DEF,
	'rdf': P_NS_RDF,
};

function sparql_binding_to_graphql_result(g_value: SparqlBinding[string]): JsonValue {
	// substitue as node
	if('uri' === g_value.type) {
		return g_value.value;
	}
	// populate as scalar
	else if('literal' === g_value.type) {
		if(`${P_NS_XSD}boolean` === g_value.datatype) {
			return 'true' === g_value.value;
		}
		else if(`${P_NS_XSD}integer` === g_value.datatype) {
			return parseInt(g_value.value);
		}
		else {
			return g_value.value;
		}
	}

	return '';
}


function rebind(
	a_bindings: SparqlBinding[],
	h_struct: BinderStruct,
	h_out: Dict<JsonValue>,
	a_path: string[],
	a_errors: EvalError[]
) {
	// copy struct
	const h_local = {...h_struct};

	// iterate into struct first to clear scalars
	for(const [si_key, z_target] of ode(h_local)) {
		// terminal scalar
		if('string' === typeof z_target) {
			// reduce values
			const as_scalars = new Set<boolean | number | string>();
			const as_objects = new Set<string>();

			// each binding; add to values set
			for(const g_binding of a_bindings) {
				let w_intermediate = sparql_binding_to_graphql_result(g_binding[z_target]);

				// merge objects
				if('object' === typeof w_intermediate) {
					as_objects.add(JSON.stringify(w_intermediate));
				}
				// merge scalars
				else {
					// special proocessing for __typename; convert IRI to class name
					if('__typename' === si_key && 'string' === typeof w_intermediate) {
						w_intermediate = w_intermediate.replace(/^.*?([^#/]+)$/, '$1');
					}

					as_scalars.add(w_intermediate as boolean | number | string);
				}
			}

			// divergent values
			if((as_scalars.size + as_objects.size) > 1) {
				// root-level selector
				if(1 === a_path.length) {
					a_errors.push({
						message: `Multiple results encountered for top-level selector; did you mean to use \`${a_path[0]}s\` instead?`,
						bindingPath: a_path.join('.'),
					});
				}
				// nested selector
				else {
					a_errors.push({
						message: `Multiple divergent bindings encountered; try adding the \`@many\` directive after \`${a_path.at(-1)}\` to collate results.`,
						bindingPath: a_path.join('.'),
					});
				}

				// stop iterating
				return;
			}
			// single scalar value
			else if(as_scalars.size) {
				h_out[si_key] = [...as_scalars][0];
			}
			// single object value
			else {
				h_out[si_key] = JSON.parse([...as_objects][0]);
			}

			// remove from local struct
			delete h_local[si_key];
		}
	}

	// iterate into struct
	for(const [si_key, z_target] of ode(h_local)) {
		// array
		if(Array.isArray(z_target)) {
			const h_shape = z_target[0];

			// collate
			const si_var = h_shape['$iri'] as string;

			// into buckets
			const h_buckets: Dict<{
				object: JsonObject;
				bindings: SparqlBinding[];
			}> = {};

			// each binding
			for(const h_binding of a_bindings) {
				// resolve to iri
				const p_item = h_binding[si_var].value;

				// place into bucket
				(h_buckets[p_item] = h_buckets[p_item] || {
					object: {
						$iri: p_item,
					},
					bindings: [],
				}).bindings.push(h_binding);
			}

			// prep values list
			const a_values: Dict<JsonValue>[] = [];

			// each bucket
			for(const [p_iri, g_bucket] of ode(h_buckets)) {
				// copy shape
				const h_copy = {...h_shape};

				// delete `$iri` key from copy
				delete h_copy['$iri'];

				// generate subpath
				const a_subpath = [...a_path, `${si_key}["${p_iri}"]`];

				// prepare object
				const h_object = g_bucket.object as Dict<JsonValue>;

				// apply rebinding
				rebind(g_bucket.bindings, h_copy as BinderStruct, h_object, a_subpath, a_errors);

				// append to list
				a_values.push(h_object);
			}

			// set in out
			h_out[si_key] = a_values;
		}
		// object
		else if('object' === typeof z_target) {
			// nest out
			const h_nested = h_out[si_key] = {};

			// apply rebinding
			rebind(a_bindings, z_target as BinderStruct, h_nested, [...a_path, si_key], a_errors);
		}
	}
}


export async function exec_plan(g_plan: SparqlPlan, p_endpoint: string): Promise<{
	bindings: Dict<JsonValue>;
	errors: EvalError[];
	query: string;
}> {
	const y_gen = new sparqljs.Generator();

	const sx_sparql = y_gen.stringify({
		queryType: 'SELECT',
		variables: [{
			termType: 'Wildcard',
			value: '*',
			equals: () => false,
		}],
		type: 'query',
		prefixes: h_prefixes,
		where: g_plan.where,
	});

	const d_res = await fetch(p_endpoint, {
		method: 'POST',
		body: new URLSearchParams({
			query: sx_sparql,
		}),
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Accept': 'application/sparql-results+json',
		},
	});

	if(!d_res.ok) {
		return {
			bindings: {},
			errors: [{
				message: await d_res.text(),
			}],
			query: sx_sparql,
		};
	}

	const g_response = await d_res.json() as {
		results: {
			bindings: SparqlBinding[];
		};
	};


	// prep output
	const h_output: Dict<JsonValue> = {};

	// prep errors
	const a_errors: EvalError[] = [];

	// rebind results
	rebind(g_response.results.bindings, g_plan.shape, h_output, [], a_errors);

	return {
		bindings: h_output,
		errors: a_errors,
		query: sx_sparql,
	};
}
