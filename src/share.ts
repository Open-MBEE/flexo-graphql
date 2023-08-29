import type {Dict, Arrayable, JsonObject} from '@blake.regalia/belt';

import type {Quad} from '@rdfjs/types';

import type {Pattern} from 'sparqljs';

import {default as factory} from '@rdfjs/data-model';

export type BinderStruct = Dict<Arrayable<JsonObject>>;

export interface SparqlPlan {
	where: Pattern[];
	shape: BinderStruct;
	errors: string[];
}

export const P_NS_XSD = 'http://www.w3.org/2001/XMLSchema#';

export const P_NS_BASE = 'https://cae-jama.jpl.nasa.gov/rest/v1#';
export const P_NS_DEF = `${P_NS_BASE}/definitions/`;
export const P_NS_RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

export const G_RDF_TYPE = factory.namedNode(`${P_NS_RDF}type`);

export const A_PRIMITIVES = [
	'Int',
	'Float',
	'String',
	'Boolean',
	'ID',
];
