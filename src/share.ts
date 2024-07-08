import type {Dict, Arrayable, JsonObject} from 'npm:@blake.regalia/belt@^0.37.0';
import type {Pattern} from 'npm:@types/sparqljs@^3';

import {default as factory} from 'npm:@rdfjs/data-model@^1.1.0';

import {P_NS_RDF} from './constants.ts';

export type BinderStruct = Dict<Arrayable<JsonObject>>;

export type QueryModifiers = {
	limit?: number;
	offset?: number;
	order?: {
		expression: string;
		descending?: boolean;
	}[];
};

export interface SparqlPlan {
	where: Pattern[];
	extras: QueryModifiers;
	shape: BinderStruct;
	errors: EvalError[];
}

export type EvalError = {
	message: string;
	bindingPath?: string;
};

export const G_RDF_TYPE = factory.namedNode(`${P_NS_RDF}type`);
