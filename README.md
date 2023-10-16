# Welcome to @cap-js/change-tracking

## About this project

`@cap-js/change-tracking` is a CDS plugin providing out-of-the box support for automatic capturing, storing, and viewing of the change records of modeled entities.

In this guide, we use the [Incidents Management reference sample app](https://github.com/cap-js/incidents-app) as the base to add change tracking to.

## Add the Plugin

To enable change tracking, simply add the [`@cap-js/change-tracking`](https://www.npmjs.com/package/@cap-js/change-tracking) plugin package to your project like so:

```sh
npm add @cap-js/change-tracking
```

## Annotate with `@changelog`

Next, we need to identify what should be change-tracked by annotating respective entities and elements in our model with the `@changelog` annotation. Following the [best practice of separation of concerns](../domain-modeling#separation-of-concerns), we do so in a separate file _srv/change-tracking.cds_ as follows:

```cds
using { ProcessorService as my } from '@capire/incidents';
annotate my.Incidents @changelog: [ customer.name, createdAt ] {
  customer @changelog: [ customer.name ];
  title  @changelog;
  status @changelog;
}
annotate my.Conversations @changelog: [ author, timestamp ] {
  message  @changelog;
}
```

### Human-readable Types

TODO:

- via @title / @Common.Label + i18n
- add screenshots

### Human-readable IDs

By adding the annotation `@changelog`, we already change-track both entities and elements. Only for definitions that are not uniquely mapped, for example when referring to a type `enum` or `Association`, an extra array of identifiers can be provided to make the resulting Object ID *human-readable* in the [*Change History* view](#change-history-view). Otherwise, the respective unique IDs will be used which can be very cryptic, so we advise against this.

### Human-readable Values

TODO:

- Via [...]
- add screenshots

## Test-drive Locally

With the steps above, we have successfully set up change tracking for our reference application. Let's see that in action.

1. **Start the server** as usual:

  ```sh
  cds watch
  ```

  You should see the following in your console output, indicating the change tracking is now active:

  ```log
  [cds] - loaded model from 6 file(s):
    @cap-js/change-tracking/index.cds // [!code focus]
    app/services.cds
    app/incidents/annotations.cds
    srv/processors-service.cds
    db/schema.cds
    node_modules/@sap/cds/common.cds
  ```

2. **Make a change** on your change-tracked elements:
    Any change you make on the records which you have change-tracked will now be persisted in a database table `sap.changelog.ChangeLog` and a pre-defined view with Fiori elements annotations is available through `sap.changelog.ChangeView` as described in the next section.

## Change History view

TODO: → add screenshots

If you have a Fiori Element application, the CDS plugin automatically provides and generates a view `sap.changelog.ChangeView`, the facet of which is added to the Object Page of your change-tracked entities/elements. In the UI, this corresponds to the *Change History* table which helps you to view and search the stored change records of your modeled entities.

The **Field**/**Object Type** columns will provide *human-readable* properties when the respective element/entity is annotated with a localized `@Common.Label'.

### Customizing

The view can be easily adapted and configured to your own needs by simply changing or extending it. For example, let's assume we only want to show the first 4 columns in equal spacing, we would annotate as follows:

```cds
annotate sap.changelog.ChangeView with @(
    UI.LineItem : [
      { Value: modification, @HTML5.CssDefaults: {width:'25%'}},
      { Value: createdAt, @HTML5.CssDefaults: {width:'25%'}},
      { Value: createdBy, @HTML5.CssDefaults: {width:'25%'}},
      { Value: objectID, @HTML5.CssDefaults: {width:'25%'}}
  ]
);
```
In the UI, the *Change History* table now contains 4 equally-spaced columns with the desired properties.

For more information and examples on adding Fiori Annotations, see [Adding SAP Fiori Annotations](http://localhost:5173/docs/advanced/fiori#fiori-annotations).

## Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/cap-js/change-tracking/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright 2023 SAP SE or an SAP affiliate company and contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/cap-js/change-tracking).
