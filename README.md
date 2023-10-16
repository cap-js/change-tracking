# Welcome to @cap-js/change-tracking


## About this project

`@cap-js/change-tracking` is a [CDS plugin](https://cap.cloud.sap/docs/node.js/cds-plugins#cds-plugin-packages) providing out-of-the box support for automatic capturing, storing, and viewing of the change records of modeled entities.


## Usage

In this guide, we use the [Incidents Management reference sample app](https://github.com/cap-js/incidents-app) as the base to add change tracking to.

### Add the CDS Plugin

To enable change tracking, simply add this plugin package to your project:

```sh
npm add @cap-js/change-tracking
### Annotate with `@changelog`

Next, we need to identify what should be change-tracked by annotating respective entities and elements in our model with the `@changelog` annotation. Following the [best practice of separation of concerns](https://cap.cloud.sap/docs/guides/domain-modeling#separation-of-concerns), we do so in a separate file _srv/change-tracking.cds_:

```cds
using { ProcessorService as my } from './processor-service';

annotate sap.capire.incidents.Incidents @title: 'Incidents';
annotate sap.capire.incidents.Conversations @title: 'Conversations';

annotate my.Incidents @changelog: [ customer.name, createdAt ] {
  customer @changelog: [ customer.name ] @title: 'Customer';
  title  @changelog;
  status @changelog;
}

annotate my.Conversations @changelog: [ author, timestamp ] {
  message  @changelog @Common.Label: 'Message';
}
```

By adding the annotation `@changelog`, we have already change-tracked everything.

However, as we can see in our file above, additional identifiers or labels may be necessary to obtain better *human-readable* change records. These are described below.

#### Human-readable IDs and Values
The columns *Object ID* and *Parent Object ID* are already human-readable by default, unless the `@changelog` definition cannot be uniquely mapped such as types `enum` or `Association`. In our example, we have added `[ customer.name, createdAt ]` for incidents and `[ customer.name ]` for conversations entities to obtain columns consisting of the customer's name and timestamp or the author's name and timestamp respectively. This is similar for elements, where we have added `[ customer.name ]` to element `customer` to obtain human-readable *Old Value* and *New Value* records.

#### Human-readable Fields and Types
To obtain human-readable columns *Field* and *Object Type*, the respective entity or element needs with be annotated with either `@Common.Label` or `@title`. In our example, we have annotated the entities `Incidents` and `Conversations` with `@title: 'Incidents'` and `@title: 'Conversations'` respectively for human-readable *Object Type* records. Human-readable *Fields* records, `@Common.Label` annotations already exist and are coming from the existing [service model](https://github.com/cap-js/incidents-app/blob/main/app/incidents/annotations.cds).

### Test-drive Locally

With the steps above, we have successfully set up change tracking for our reference application. Let's see that in action.

1. **Start the server**:

  ```sh
  cds watch
  ```
2. **Make a change** on your change-tracked elements. This change will automatically be persisted in the database table (`sap.changelog.ChangeLog`) and made available in a pre-defined view, namely the [Change History view](#change-history-view) for your convenvience.

### Change History view

<img width="1311" alt="change-history" src="https://github.com/cap-js/change-tracking/assets/8320933/3e4924d4-c857-48bd-98b8-3d94c214cb7e">

If you have a Fiori Element application, the CDS plugin automatically provides and generates a view `sap.changelog.ChangeView`, the facet of which is automatically added to the Fiori Object Page of your change-tracked entities/elements. In the UI, this corresponds to the *Change History* table which serves to help you to view and search the stored change records of your modeled entities.

### Customizations

The view can be easily adapted and configured to your own needs by simply changing or extending it. For example, let's assume we only want to show the first 4 columns in equal spacing, we would extend _srv/change-tracking.cds_ as follows:

```cds
using from '@cap-js/change-tracking';

annotate sap.changelog.ChangeView with @(
  UI.LineItem : [
    { Value: modification, @HTML5.CssDefaults: { width:'25%' }},
    { Value: createdAt,    @HTML5.CssDefaults: { width:'25%' }},
    { Value: createdBy,    @HTML5.CssDefaults: { width:'25%' }},
    { Value: objectID,     @HTML5.CssDefaults: { width:'25%' }}
  ]
);
```
In the UI, the *Change History* table now contains 4 equally-spaced columns with the desired properties:

<img width="1310" alt="change-history-custom" src="https://github.com/cap-js/change-tracking/assets/8320933/6019664b-ed14-4abb-880f-4f581c298a07">

For more information and examples on adding Fiori Annotations, see [Adding SAP Fiori Annotations](https://cap.cloud.sap/docs/advanced/fiori#fiori-annotations).


## Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/cap-js/change-tracking/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).


## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](CODE_OF_CONDUCT.md) at all times.


## Licensing

Copyright 2023 SAP SE or an SAP affiliate company and contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/cap-js/change-tracking).
