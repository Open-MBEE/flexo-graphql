# Flexo GraphQL

## Requirements

 - [Deno](https://deno.com/)
 - [https://velociraptor.run/](Velociraptor) (script runner for Deno projects)


## Install

```sh
vr install
```


## Running the GraphQL server

```sh
vr serve -c context.json -s schema.graphql
```

By default, the server attempts to bind to port `3001`.

The GraphQL endpoint will be available (via POST requests) at: http://localhost:3001/graphql

You can also open the following URL in your browser to access the GraphiQL interface: http://localhost:3001/


## Documentation

The endpoint provides schema introspection to help clients validate their queries.


## Inverse predicates

Properties that are prefixed by `_inv_` signify an incoming relationship from another object:

```graphql
{
  user {
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
    version: _any {
      # specify the intended type using an inline fragment
      ...on Version {
        id
      }
    }
  }
}
```


### `@filter`` directive

Can be used to apply a filter on scalar values:

```graphql
{
  item {
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
| notContains              | String        |                           |
| startsWith               | String        | value starts with string  |
| notStartsWith            | String        |                           |
| endsWith                 | String        | value ends with string    |
| notEndsWith              | String        |                           |
| regex                    | String        | regular expression match  |
| notRegex                 | String        |                           |
| equals                   | Float         | numeric equals            |
| notEquals                | Float         |                           |
| lessThan                 | Float         | numeric less than         |
| notLessThan              | Float         |                           |
| greaterThan              | Float         | numeric greater than      |
| notGreaterThan           | Float         |                           |
| lessThanOrEqualTo        | Float         |                           |
| notLessThanOrEqualTo     | Float         |                           |
| greaterThanOrEqualTo     | Float         |                           |
| notGreaterThanOrEqualTo  | Float         |                           |


### `@many` directive

Tells the service where to collate results:

```graphql
{
  pickLists {
    options: _inv_pickList @many {
      ...on PickListOption {
        name
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
