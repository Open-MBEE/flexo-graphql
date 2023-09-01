import type {GraphqlRewriterConfig} from './rewriter.ts';
import type {OakResponse, OakResponseBody} from '../deps.ts';

import {GraphqlRewriter} from './rewriter.ts';
import {exec_plan} from './sparql.ts';

import {Application, Router, oakCors, oderac, parseCli, parseContentType} from '../deps.ts';
import { SchemaHandler, handle_schema_request } from './apollo.ts';

const SX_MIME_JSON = 'application/json';
const SX_MIME_GRAPHQL_RESPONSE = 'application/graphql-response+json';

const A_ACCEPTABLE_MIMES = [SX_MIME_JSON, SX_MIME_GRAPHQL_RESPONSE];

const y_app = new Application();

const close_res = (d_res: OakResponse, xc_code: number, w_body: OakResponseBody): void => {
	d_res.status = xc_code;
	d_res.body = w_body;
};

const H_OPT_ALIASES = {
	c: 'context',
	s: 'schema',
	p: 'port,'
};

const h_flags = parseCli(Deno.args, {
	boolean: ['help'],
	string: Object.values(H_OPT_ALIASES),
	alias: {
		h: 'help',
		...H_OPT_ALIASES,
	},
});

if(h_flags['help'] || h_flags['h']) {
	console.log([
		'Options:',
		...oderac(H_OPT_ALIASES, (si_alias, si_flag) => `  --${si_flag} or -${si_alias} [VALUE]`).join('\n'),
	]);
	Deno.exit(0);
}

const sr_jsonld_context = h_flags['context'] || h_flags['c'] || '';
const sr_graphql_schema = h_flags['schema'] || h_flags['s'] || '';
const n_port = parseInt(h_flags['port'] || h_flags['p'] || '3001');

const sx_jsonld_context = sr_jsonld_context? Deno.readTextFileSync(sr_jsonld_context): '';
const sx_graphql_schema = sr_graphql_schema? Deno.readTextFileSync(sr_graphql_schema): '';

const k_rewriter = await GraphqlRewriter.create({
	schema: sx_graphql_schema,
	context: (JSON.parse(sx_jsonld_context) as {
		'@context': GraphqlRewriterConfig['context'];
	})['@context'],
});

const y_apollo = new SchemaHandler(sx_graphql_schema);

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

		// treat as schema request
		try {
			const g_res = await y_apollo.handle(sx_query);

			// apollo handled it
			if(g_res?.data && !g_res.errors?.length) {
				// close response
				d_res.body = g_res;

				// exit
				return;
			}
		}
		catch(e_schema) {}

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

y_app.use(oakCors());
y_app.use(y_router.routes());
y_app.use(y_router.allowedMethods());

y_app.listen({
	port: n_port,
});



