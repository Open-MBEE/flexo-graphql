import type {GraphqlRewriterConfig} from './rewriter.ts';
import type {OakResponse, OakResponseBody, BodyJson} from '../deps.ts';

import {GraphqlRewriter} from './rewriter.ts';
import {exec_plan} from './sparql.ts';


import {Application, Router, parseContentType} from '../deps.ts';

const SX_MIME_JSON = 'application/json';
const SX_MIME_GRAPHQL_RESPONSE = 'application/graphql-response+json';

const A_ACCEPTABLE_MIMES = [SX_MIME_JSON, SX_MIME_GRAPHQL_RESPONSE];

const y_app = new Application();

const close_res = (d_res: OakResponse, xc_code: number, w_body: OakResponseBody): void => {
	d_res.status = xc_code;
	d_res.body = w_body;
};

const A_OPT_JSONLD_CONTEXT = ['--context', '-c'];
const A_OPT_GRAPHQL_SCHEMA = ['--schema', '-s'];

let sx_jsonld_context = '';
let sx_graphql_schema = '';
{
	const a_args = [...Deno.args];
	for(; a_args.length;) {
		const s_arg = a_args.shift()!;

		if([...A_OPT_JSONLD_CONTEXT, ...A_OPT_GRAPHQL_SCHEMA].includes(s_arg)) {
			const s_value = a_args.shift();

			if(!s_value) {
				throw new Error(`Missing value for '${s_arg}' option`);
			}
			else if(A_OPT_JSONLD_CONTEXT.includes(s_arg)) {
				sx_jsonld_context = Deno.readTextFileSync(s_value);
			}
			else if(A_OPT_GRAPHQL_SCHEMA.includes(s_arg)) {
				sx_graphql_schema = Deno.readTextFileSync(s_value);
			}
			else {
				throw new Error(`Unknown CLI options parsing error`);
			}
		}
	}
}

const k_rewriter = await GraphqlRewriter.create({
	schema: sx_graphql_schema,
	context: (JSON.parse(sx_jsonld_context) as {
		'@context': GraphqlRewriterConfig['context'];
	})['@context'],
});

const y_router = new Router()
	.post('/graphql', async({request:d_req, response:d_res}) => {
		// parse content type from request header
		const g_type = parseContentType(d_req.headers.get('content-type') || 'text/html');

		// incorrect content type
		if(SX_MIME_JSON !== g_type.type) {
			// close response with http error
			return close_res(d_res, 415, {
				error: 'Content-Type must be application/json',
			});
		}

		// incorrect accept type
		if(!d_req.accepts(...A_ACCEPTABLE_MIMES)) {
			return close_res(d_res, 405, {
				error: `Accept header must be one of [${A_ACCEPTABLE_MIMES.map(s => `"${s}"`).join(', ')}]`,
			});
		}

		// handle json
		let g_value: any;
		try {
			// parse request body as json
			const g_body = d_req.body({
				type: 'json',
			});

			// read body value
			g_value = await g_body.value;
		}
		// parsing error
		catch(e_parse) {
			return close_res(d_res, 400, {
				error: `Invalid request body JSON: ${(e_parse as Error).message}`,
			});
		}

		// ref graphql query string
		const sx_query = g_value.query;

		// invalid request shape
		if('string' !== typeof sx_query) {
			return close_res(d_res, 400, {
				error: `The 'query' key in the request body JSON must be a string`,
			});
		}

		// translate query to sparql plan
		const g_plan = k_rewriter.rewrite(sx_query);

		// errors
		if(g_plan.errors.length) {
			// respond
			d_res.body = {
				errors: g_plan.errors,
			};

			// exit
			return;
		}

		// execute sparql plan
		const {
			bindings: h_output,
			query: sx_sparql,
		} = await exec_plan(g_plan);

		// return output bindings
		d_res.body = {
			data: h_output,
			errors: [],
			sparql: sx_sparql,
		};
	});

y_app.use(y_router.routes());
y_app.use(y_router.allowedMethods());

y_app.listen({
	port: 3001,
});

// (async() => {
// 	const h_queries = {
// 		all_picklist_options: `
// 			{
// 				pickLists {
// 					name
// 					options: pickList @inverse @many {
// 						... on PickListOption {
// 							name
// 						}
// 					}
// 				}
// 			}
// 		`,

// 		l3_reqs: `
// 			{
// 				items {
// 					fields {
// 						state: __any {
// 							... on PickListOption {
// 								pickList(name: "MSR_Level")
// 								name @filter(equals: "L3")
// 							}
// 						}
// 					}
// 				}
// 			}
// 		`,
// 	};

// 	const g_plan = graphql_query_to_sparql_plan(h_queries.l3_reqs);

// 	const h_output = await exec_plan(g_plan);

// 	console.log(JSON.stringify(h_output, null, '  '));
// })();
