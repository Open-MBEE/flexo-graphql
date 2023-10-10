import type {GraphqlRewriterConfig} from './rewriter.ts';
import type {Response as OakResponse} from 'https://deno.land/x/oak@v12.6.1/mod.ts';
import type {ResponseBody as OakResponseBody} from 'https://deno.land/x/oak@v12.6.1/response.ts';

import {parse as parseCli} from 'https://deno.land/std@0.203.0/flags/mod.ts';
import {parse as parseContentType} from 'https://deno.land/x/content_type@1.0.1/mod.ts';
import {oakCors} from 'https://deno.land/x/cors@v1.2.2/mod.ts';
import {Application, Router} from 'https://deno.land/x/oak@v12.6.1/mod.ts';
import {send} from 'https://deno.land/x/oak@v12.6.1/send.ts';
import {oderac} from 'npm:@blake.regalia/belt@^0.15.0';

import {SchemaHandler} from './apollo.ts';
import {GraphqlRewriter} from './rewriter.ts';
import {exec_plan} from './sparql.ts';


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
	p: 'port',
};

const H_OPT_DESC = {
	c: '[required] path to JSON-LD context file',
	s: '[required] path to GraphQL schema file',
	p: '[optional] port number to bind server',
};

const h_flags = parseCli(Deno.args, {
	boolean: ['help'],
	string: Object.values(H_OPT_ALIASES),
	alias: {
		h: 'help',
		...H_OPT_ALIASES,
	},
});

const sr_jsonld_context = h_flags['context'] || h_flags['c'] || '';
const sr_graphql_schema = h_flags['schema'] || h_flags['s'] || '';
const n_port = parseInt(h_flags['port'] || h_flags['p'] || '3001');

if(h_flags['help'] || h_flags['h'] || !sr_jsonld_context || !sr_graphql_schema) {
	console.error(
		`Usage: vr serve [OPTIONS]\n`
		+`\nOptions:\n${oderac(H_OPT_ALIASES, (si_alias, si_flag) => `  -${si_alias}, --${si_flag} ${'p' === si_alias? 'VALUE': 'PATH'}`.padEnd(22, ' ')+H_OPT_DESC[si_alias]).join('\n')}\n`
		+`\nExample: vr serve -c res/context.json -s res/schema.graphql`
	);
	Deno.exit(h_flags['help'] || h_flags['h']? 0: 1);
}

const P_ENDPOINT = Deno.env.get('SPARQL_ENDPOINT')!;

if(!P_ENDPOINT) {
	console.error(`Must define environment variable SPARQL_ENDPOINT`);
	Deno.exit(1);
}

const sx_jsonld_context = sr_jsonld_context? Deno.readTextFileSync(sr_jsonld_context): '';
const sx_graphql_schema = sr_graphql_schema? Deno.readTextFileSync(sr_graphql_schema): '';

const k_rewriter = await GraphqlRewriter.create({
	schema: sx_graphql_schema,
	context: (JSON.parse(sx_jsonld_context) as {
		'@context': GraphqlRewriterConfig['context'];
	})['@context'],
});

const y_apollo = new SchemaHandler(sx_graphql_schema);

const sx_pattern = `/orgs/:org/repos/:repo/branches/:branch`;

const y_router = new Router()
	.get('/', async(y_ctx) => {
		const d_params = y_ctx.request.url.searchParams;
		if(d_params.has('org') && d_params.has('repo')) {
			return await y_ctx.response.redirect(`/orgs/${d_params.get('org')}/repos/${d_params.get('repo')}/branches/${d_params.get('branch') || 'master'}/`);
		}

		await send(y_ctx, './', {
			root: `${Deno.cwd()}/public`,
			index: 'index.html',
		});
	})
	.get(`${sx_pattern}/`, async(y_ctx) => {
		await send(y_ctx, './', {
			root: `${Deno.cwd()}/public`,
			index: 'graphiql.html',
		});
	})
	.post(`${sx_pattern}/graphql`, async({request:d_req, response:d_res, params:h_params}) => {
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
				// not a singular request type
				const a_entries = Object.entries(g_res.data);
				if(1 !== a_entries.length || null !== a_entries[0][1]) {
					// close response
					d_res.body = g_res;

					// exit
					return;
				}
			}
		}
		catch(e_schema) {}

		// translate query to sparql plan
		const g_plan = k_rewriter.rewrite(sx_query, g_value.variables || {});

		// errors
		if(g_plan.errors.length) {
			// respond
			d_res.body = {
				data: null,
				errors: g_plan.errors,
			};

			// exit
			return;
		}

		// materialize endpoint URL
		const p_endpoint = P_ENDPOINT.replace(/\$\{([^}]+)\}/g, (s_0, s_var: keyof typeof h_params) => h_params[s_var]!);

		// execute sparql plan
		const {
			bindings: h_output,
			errors: a_errors,
			query: sx_sparql,
		} = await exec_plan(g_plan, p_endpoint);

		// return output bindings
		d_res.body = a_errors.length
			? {
				data: null,
				errors: a_errors,
				sparql: sx_sparql,
			}
			: {
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

console.log(`Listening on port ${n_port}`);

