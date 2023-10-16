# Welcome to @cap-js/change-tracking


## About this project

`@cap-js/change-tracking` is a CDS plugin providing out-of-the box support for automatic capturing, storing, and viewing of the change records of modeled entities.


## Installation

To enable change tracking, simply add the [`@cap-js/change-tracking`](https://www.npmjs.com/package/@cap-js/change-tracking) plugin package to your project:

```sh
npm add @cap-js/change-tracking
```

## Usage

In this guide, we use the [Incidents Management reference sample app](https://github.com/cap-js/incidents-app) as the base to add change tracking to.

### Annotate with `@changelog`

Next, we need to identify what should be change-tracked by annotating respective entities and elements in our model with the `@changelog` annotation. Following the [best practice of separation of concerns](../domain-modeling#separation-of-concerns), we do so in a separate file _srv/change-tracking.cds_:

```cds
using { ProcessorService as my } from '@capire/incidents';

annotate sap.capire.incidents.Incidents @title: 'Incidents';
annotate sap.capire.incidents.Conversations @title: 'Conversations';

annotate my.Incidents @changelog: [ customer.name, createdAt ] {
  customer @changelog: [ customer.name ];
  title  @changelog;
  status @changelog;
}

annotate my.Conversations @changelog: [ author, timestamp ] {
  message  @changelog;
}
```

Note, that by adding the annotation `@changelog`, we are in principle already done and have change-tracked everything. However, as we can see in our example, sometimes additional identifiers or labels may be added to obtain better *human-readable* change records. These are described below.

#### Human-readable IDs and Values
The columns *Object ID*/ *Parent Object ID* are already human-readable, unless the `@changelog` definition cannot be uniquely mapped such as referring to a type `enum` or `Association`.

In our example, we have added `[ customer.name, createdAt ]` for incidents and `[ customer.name ]` for conversations to obtain columns consisting of the customer's name and timestamp or the author's name and timestamp respectively.

#### Human-readable Fields and Types
For human-readable columns *Field* and *Object Type*, the respective entity or element needs with be annotated with either `@Common.Label` or `@title`.

In our example, we have added annotated the entities `Incidents` and `Conversations` with `@title: 'Incidents'` and `@title: 'Conversations'` respectively for human-readable *Object Type* records. For human-readable *Fields*, `@Common.Label` annotations already exist and are coming from the existing [service model](https://github.com/cap-js/incidents-app/blob/main/app/incidents/annotations.cds).

### Test-drive Locally

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
    Any change you make on the records which you have change-tracked will now be persisted in a database table `sap.changelog.ChangeLog` and a pre-defined view with Fiori elements annotations `sap.changelog.ChangeView` is also provided for your convenvience in the following section.

### Change History view

<img width="1328" alt="change-tracking" src="https://github.com/cap-js/change-tracking/assets/8320933/b7aba995-327b-43d9-9029-0cdde90b20e0">

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
