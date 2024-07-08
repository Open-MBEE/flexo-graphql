
import type {FilterableFieldType} from './constants.ts';
import type {Literal, Quad_Subject} from 'npm:@rdfjs/types@^1.1.0';
import type {Pattern} from 'npm:@types/sparqljs@^3.1';
import type {
	ValueNode,
	TypeNode,
	ArgumentNode,
} from 'npm:graphql@^16.8.0';


import {default as factory} from 'npm:@rdfjs/data-model@^1.1.0';
import {Kind} from 'npm:graphql@^16.8.0';

import {H_SCALAR_FILTERS, P_NS_XSD} from './constants.ts';

interface NestedArray<w> {
	[i_index: number]: w | NestedArray<w>;
}

type NestedArrayable<w> = NestedArray<w> | w;


export function graphql_value_to_rdfjs_term(g_value: ValueNode): Literal {
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


export function graphql_value_to_sparqljs_arg(g_value: ValueNode): NestedArrayable<Literal> {
	if(Kind.LIST === g_value.kind) {
		return g_value.values.map(graphql_value_to_sparqljs_arg);
	}
	else {
		return graphql_value_to_rdfjs_term(g_value);
	}
}

export enum Plurality {
	NULLABLE,
	NONNULLABLE,
}

export function unwrap_field_type(g_def_type: TypeNode): {
	type: string;
	nonnull: boolean;
	plurality: Plurality[];
} {
	// prep root type non-nullability
	let b_nonnull = false;

	// prep nestable plurality
	const a_plurality: Plurality[] = [];

	// unwrap non-null type
	if(Kind.NON_NULL_TYPE === g_def_type.kind) {
		b_nonnull = true;
		g_def_type = g_def_type.type;
	}

	// unwrap list
	while(Kind.LIST_TYPE === g_def_type.kind) {
		// unwrap list
		g_def_type = g_def_type.type;

		// unwrap nested non-null type
		if(Kind.NON_NULL_TYPE === g_def_type.kind) {
			a_plurality.push(Plurality.NONNULLABLE);
			g_def_type = g_def_type.type;
		}
		else {
			a_plurality.push(Plurality.NULLABLE);
		}
	}

	// not named type
	if(Kind.NAMED_TYPE !== g_def_type.kind) {
		throw new Error(`Failed to unwrap type node; please report this as a bug`);
	}

	// ref unwrapped type
	const si_type = g_def_type.name.value;

	return {
		type: si_type,
		nonnull: b_nonnull,
		plurality: a_plurality,
	};
}

export function apply_filter_args(
	si_type: FilterableFieldType,
	a_args: ArgumentNode[],
	g_target: Quad_Subject,
	a_where: Pattern[]=[]
) {
	const g_ops = H_SCALAR_FILTERS[si_type];

	// each argument
	for(const g_arg of a_args) {
		let si_filter = g_arg.name.value;

		// expression placeholder
		let g_expression: {
			type: 'operation';
			operator: string;
			args: any[];
		};

		// merged ops
		const h_merged = {...g_ops.flat, ...g_ops.list};

		// negation
		let b_negate = false;
		if(!(si_filter in h_merged) && si_filter.startsWith('not')) {
			b_negate = true;
			si_filter = si_filter.replace(/^not(\w)/, (s_all, s_char) => s_char.toLowerCase());
		}

		// by binary comparison
		if(si_filter in h_merged) {
			g_expression = {
				type: 'operation',
				operator: h_merged[si_filter],
				args: [
					g_target,
					graphql_value_to_sparqljs_arg(g_arg.value),
				],
			};
		}
		// using regex comparison
		else if('regex' === si_filter) {
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
			throw new Error(`Unknown operator "${si_filter}"`);
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

	return a_where;
}
