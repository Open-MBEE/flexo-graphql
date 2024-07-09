/* eslint-disable @typescript-eslint/naming-convention */
import type {Dict} from 'npm:@blake.regalia/belt@^0.37.0';

import type {InputValueDefinitionNode, NameNode, TypeNode} from 'npm:graphql@^16.8.0';

import {fodemtv, oderom} from 'npm:@blake.regalia/belt@^0.37.0';
import {Kind} from 'npm:graphql@^16.8.0';

export const P_NS_XSD = 'http://www.w3.org/2001/XMLSchema#';

export const P_NS_BASE = 'https://cae-jama.jpl.nasa.gov/rest/v1#';
export const P_NS_DEF = `${P_NS_BASE}/definitions/`;
export const P_NS_RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

export const A_SCALARS = [
	'Boolean',
	'Int',
	'Float',
	'String',
	'ID',
] as const;

export type ScalarType = typeof A_SCALARS[number];

const H_BINARY_OPS_ANY = {
	is: '=',
	not: '!=',
};

const H_BINARY_OPS_NUMERIC = {
	...H_BINARY_OPS_ANY,
	// equals: '=',
	// notEquals: '!=',
	lessThan: '<',
	greaterThan: '>',
	lessThanOrEqualTo: '<=',
	greaterThanOrEqualTo: '>=',
};

const H_BINARY_OPS_ANY_LIST = {
	in: 'in',
	notIn: 'notin',
};

const H_BINARY_OPS_STRING = {
	...H_BINARY_OPS_ANY,

	contains: 'contains',
	startsWith: 'strStarts',
	endsWith: 'strEnds',
	regex: 'regex',
};

export type FilterableFieldType = 'Boolean' | 'Int' | 'Float' | 'String' | 'ID';

export const H_SCALAR_FILTERS: Record<FilterableFieldType, {
	flat: Dict;
	list: Dict;
}> = {
	Boolean: {
		flat: H_BINARY_OPS_ANY,
		list: H_BINARY_OPS_ANY_LIST,
	},

	String: {
		flat: H_BINARY_OPS_STRING,
		list: H_BINARY_OPS_ANY_LIST,
	},

	Int: {
		flat: H_BINARY_OPS_NUMERIC,
		list: H_BINARY_OPS_ANY_LIST,
	},

	Float: {
		flat: H_BINARY_OPS_NUMERIC,
		list: H_BINARY_OPS_ANY_LIST,
	},

	ID: {
		flat: H_BINARY_OPS_STRING,
		list: H_BINARY_OPS_ANY_LIST,
	},
};

export const graphql_name = (si_name: string): NameNode => ({
	kind: Kind.NAME,
	value: si_name,
});

export const graphql_named_type = (si_type: string): TypeNode => ({
	kind: Kind.NAMED_TYPE,
	name: graphql_name(si_type),
});

const graphql_scalar_filter = (si_param: string, si_type: ScalarType, b_list: boolean): InputValueDefinitionNode => ({
	kind: Kind.INPUT_VALUE_DEFINITION,
	name: graphql_name(si_param),
	type: b_list? {
		kind: Kind.LIST_TYPE,
		type: graphql_named_type(si_type as string),
	}: graphql_named_type(si_type as string),
});

export const H_SCALAR_FILTER_ARGUMENTS = fodemtv(H_SCALAR_FILTERS, (g_ops, si_type) => Object.values({
	...fodemtv(g_ops.flat || {}, (_si_op, si_param) => graphql_scalar_filter(si_param, si_type, false)),
	...fodemtv(g_ops.list || {}, (_si_op, si_param) => graphql_scalar_filter(si_param, si_type, true)),
})) as unknown as Record<keyof typeof H_SCALAR_FILTERS, InputValueDefinitionNode>;
