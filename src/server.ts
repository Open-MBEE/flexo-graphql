import type {GraphqlRewriterConfig} from './rewriter.ts';
import type {QueryModifiers} from './share.ts';
import type {Response as OakResponse, Request as OakRequest, RouterContext} from 'jsr:@oak/oak';
import type {ResponseBody as OakResponseBody} from 'jsr:@oak/oak/response';

import type {JsonObject} from 'npm:@blake.regalia/belt@^0.37.0';
import type {ASTNode} from 'npm:graphql@^16.8.0';

import {parseArgs} from '@std/cli/parse-args';
import {parse as parseContentType} from 'https://deno.land/x/content_type@1.0.1/mod.ts';
import {oakCors} from 'https://deno.land/x/cors@v1.2.2/mod.ts';
import {Application, Router} from 'jsr:@oak/oak';
import {send} from 'jsr:@oak/oak/send';
import {concat_entries} from 'npm:@blake.regalia/belt@^0.37.0';

import {parse, print} from 'npm:graphql@^16.8.0';

import {SchemaHandler} from './apollo.ts';
import {GraphqlRewriter} from './rewriter.ts';
import {exec_plan} from './sparql.ts';
import {transform_add_object_filters} from './transform-add-object-filters.ts';
import {transform_add_scalar_filters} from './transform-add-scalar-filters.ts';


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

const h_flags = parseArgs(Deno.args, {
	boolean: ['help'],
	string: Object.values(H_OPT_ALIASES),
	alias: {
		h: 'help',
		...H_OPT_ALIASES,
	},
});

const sr_jsonld_context = h_flags['context'] || h_flags['c'] || '';
const sr_graphql_schema = h_flags['schema'] || h_flags['s'] || '';
const n_port = parseInt((h_flags['port'] || h_flags['p'] || '3001') as string);

if(h_flags['help'] || h_flags['h'] || !sr_jsonld_context || !sr_graphql_schema) {
	console.error(
		`Usage: vr serve [OPTIONS]\n`
		+`\nOptions:\n${concat_entries(H_OPT_ALIASES, (si_alias, si_flag) => `  -${si_alias}, --${si_flag} ${'p' === si_alias? 'VALUE': 'PATH'}`.padEnd(22, ' ')+H_OPT_DESC[si_alias]).join('\n')}\n`
		+`\nExample: vr serve -c res/context.json -s res/schema.graphql`
	);
	Deno.exit(h_flags['help'] || h_flags['h']? 0: 1);
}

const P_ENDPOINT = Deno.env.get('SPARQL_ENDPOINT')!;

if(!P_ENDPOINT) {
	console.error(`Must define environment variable SPARQL_ENDPOINT`);
	Deno.exit(1);
}

const sx_jsonld_context: string = sr_jsonld_context? Deno.readTextFileSync(sr_jsonld_context): '';
const sx_graphql_schema_input: string = sr_graphql_schema? Deno.readTextFileSync(sr_graphql_schema): '';

const k_rewriter = await GraphqlRewriter.create({
	schema: sx_graphql_schema_input,
	context: (JSON.parse(sx_jsonld_context) as {
		'@context': GraphqlRewriterConfig['context'];
	})['@context'],
});

// transform input schema by adding filter functions for scalar types
const y_doc_schema_input = parse(sx_graphql_schema_input);
const y_doc_schema_transformed = transform_add_scalar_filters(
	transform_add_object_filters(y_doc_schema_input)
) as ASTNode;
const sx_graphql_schema_transformed = print(y_doc_schema_transformed) as string;

// instantiate apollo server
const y_apollo = new SchemaHandler(sx_graphql_schema_transformed);

// route pattern
const sx_pattern = `/orgs/:org/repos/:repo/branches/:branch`;

async function graphiql(y_ctx: RouterContext<string>) {
	await send(y_ctx, './', {
		root: `${Deno.cwd()}/public`,
		index: 'graphiql.html',
	});
}

function scrub_headers(d_req: OakRequest) {
	const h_headers = Object.fromEntries(d_req.headers.entries() as IterableIterator<[string, string]>);
	delete h_headers['accept'];
	delete h_headers['content-type'];
	delete h_headers['content-length'];
	delete h_headers['host'];
	delete h_headers['origin'];
	delete h_headers['referer'];
	delete h_headers['connection'];

	return h_headers;
}

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
	// for local deployment, proxy the login
	.get('/login', async({request:d_req, response:d_res}) => {
		const p_login = Object.assign(new URL(P_ENDPOINT as string), {
			pathname: '/login',
			search: '',
		})+'';

		// capture headers
		const h_headers = scrub_headers(d_req);

		// abort after a few seconds
		const d_controller = new AbortController();
		setTimeout(() => {
			d_controller.abort();
		}, 2e3);

		// check for login
		try {
			const d_fetch = await fetch(p_login, {
				headers: h_headers,
				signal: d_controller.signal,
			});

			// forward server response to client
			Object.assign(d_res, {
				headers: d_fetch.headers,
				body: d_fetch.body,
				status: d_fetch.status,
			});
		}
		catch(e_login) {
			d_res.status = 204;
		}
	})
	.get(`${sx_pattern}/`, graphiql)
	.get(`${sx_pattern}/graphql`, graphiql)
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
		let g_value: {
			query: string;
			variables?: JsonObject;
		} & QueryModifiers;
		try {
			// parse request body as json
			g_value = await d_req.body.json();
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
		const p_endpoint: string = P_ENDPOINT.replace(/\$\{([^}]+)\}/g, (s_0, s_var: keyof typeof h_params) => h_params[s_var]!);

		// collect all other headers
		const h_headers = scrub_headers(d_req);

		// execute sparql plan
		const {
			bindings: h_output,
			errors: a_errors,
			query: sx_sparql,
		} = await exec_plan(g_plan, p_endpoint, h_headers);

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

