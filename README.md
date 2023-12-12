# Flexo GraphQL

[![CircleCI](https://circleci.com/gh/Open-MBEE/flexo-graphql.svg?style=shield)](https://circleci.com/gh/Open-MBEE/flexo-graphql)
<details>
  <summary>SonarCloud</summary>  

[![Duplicated Lines (%)](https://sonarcloud.io/api/project_badges/measure?project=Open-MBEE_flexo-graphql&metric=duplicated_lines_density)](https://sonarcloud.io/summary/new_code?id=Open-MBEE_flexo-graphql) [![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=Open-MBEE_flexo-graphql&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=Open-MBEE_flexo-graphql) [![Technical Debt](https://sonarcloud.io/api/project_badges/measure?project=Open-MBEE_flexo-graphql&metric=sqale_index)](https://sonarcloud.io/summary/new_code?id=Open-MBEE_flexo-graphql) [![Lines of Code](https://sonarcloud.io/api/project_badges/measure?project=Open-MBEE_flexo-graphql&metric=ncloc)](https://sonarcloud.io/summary/new_code?id=Open-MBEE_flexo-graphql) [![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=Open-MBEE_flexo-graphql&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=Open-MBEE_flexo-graphql) [![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=Open-MBEE_flexo-graphql&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=Open-MBEE_flexo-graphql) [![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=Open-MBEE_flexo-graphql&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=Open-MBEE_flexo-graphql) [![Bugs](https://sonarcloud.io/api/project_badges/measure?project=Open-MBEE_flexo-graphql&metric=bugs)](https://sonarcloud.io/summary/new_code?id=Open-MBEE_flexo-graphql) [![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=Open-MBEE_flexo-graphql&metric=vulnerabilities)](https://sonarcloud.io/summary/new_code?id=Open-MBEE_flexo-graphql)  
</details>

## Requirements

 - [Deno](https://deno.com/)
 - _(optional)_ [https://velociraptor.run/](Velociraptor) (script runner for Deno projects)


## Install

```sh
vr install
```


## Running the GraphQL server

### Configure the SPARQL endpoint

Define a `SPARQL_ENDPOINT` environment variable that binds a **pattern** for the URL. The server will make the following substitutions in the pattern:
 - `${org}` -- replaced with the target `orgId` the user is querying
 - `${repo}` -- replaced with the target `repoId` the user is querying
 - `${branch}` -- replaced with the target `branchId` the user is querying

For example:
```bash
# notice the use of single quotes to prevent shell substitution of ${..}
SPARQL_ENDPOINT='http://localhost:7200/repositories/${org}-${repo}'
```

With this configuratino, a request to `https://graphql-server/orgs/mms/repos/test/branches/master` would forward a SPARQL request to `http://localhost:7200/repositories/mms-test`.


### Run the server

```
Usage: vr serve [OPTIONS]

Options:
  -c, --context PATH  [required] path to JSON-LD context file
  -s, --schema PATH   [required] path to GraphQL schema file
  -p, --port VALUE    [optional] port number to bind server
```

#### Example

```sh
vr serve -c context.json -s schema.graphql
```

By default, the server attempts to bind to port `3001`.

The GraphQL endpoint will be available (via POST requests) at: `/orgs/${org}/repos/${repo}/branches/${branch}/graphql`

Additionally, a GraphiQL interface is exposed at: `/orgs/${org}/repos/${repo}/branches/${branch}/`


## Documentation

The endpoint provides schema introspection to help clients validate their queries.


### `@filter`` directive

Can be used to apply a filter on scalar values:

```graphql
{
  item {
    # select items where the `name` property is exactly "Batman"
    name @filter(is: "Batman")
  }
}
```

The sole named argument provided to the `@filter` directive should be one of the following:

| Keyword                  | Argument type | Comments                  |
| ------------------------ | ------------- | ------------------------- |
| is                       | String        | exact match               |
| not                      | String        | not exact match           |
| in                       | \[String\]    | value appears in list     |
| notIn                    | \[String\]    | value not in list         |
| contains                 | String        | value contains substring  |
| notContains              | String        | _(negated)_               |
| startsWith               | String        | value starts with string  |
| notStartsWith            | String        | _(negated)_               |
| endsWith                 | String        | value ends with string    |
| notEndsWith              | String        | _(negated)_               |
| regex                    | String        | regular expression match  |
| notRegex                 | String        | _(negated)_               |
| equals                   | Float         | numeric equals            |
| notEquals                | Float         | _(negated)_               |
| lessThan                 | Float         | numeric less than         |
| notLessThan              | Float         | _(negated)_               |
| greaterThan              | Float         | numeric greater than      |
| notGreaterThan           | Float         | _(negated)_               |
| lessThanOrEqualTo        | Float         | ...                       |
| notLessThanOrEqualTo     | Float         | _(negated)_               |
| greaterThanOrEqualTo     | Float         | ...                       |
| notGreaterThanOrEqualTo  | Float         | _(negated)_               |


### `@many` directive

Tells the service where to collate results:

```graphql
{
  pickLists {
    # Picklist:PickListOptions is a 1:many relation
    options: _inv_pickList @many {
      ...on PickListOption {
        name
      }
    }
  }
}
```


## Inverse predicates

Properties that are prefixed by `_inv_` signify an incoming relationship from another object:

```graphql
{
  user {
    # select a user by their email
    email @filter(is: "jdoe@ex.org")

    # find items that were "createdBy" this user
    item: _inv_createdBy {
      name  # the item's name
    }
  }
}
```


## Wildcard predicates

The special `_any` property can be used to select any predicate (including ones not defined in the schema):

```graphql
{
  item {
    # `_any` is a wildcard, assign it the alias "version" in the results
    version: _any {
      # specify the intended type (i.e. a Version instance) using an inline fragment
      ...on Version {
        id  # the version's id
      }
    }
  }
}
```



## Contributing

Development tools/dependencies are managed using yarn and `package.json`. 

To set up the development environment:
```sh
yarn install
```

Checking for updates to the development dependencies:
```sh
yarn dev-update-check
```

Applying updates to the development dependencies:
```sh
yarn dev-upgrade
```
