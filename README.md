# About this project

`@cap-js/change-tracking` is a [CDS plugin](https://cap.cloud.sap/docs/node.js/cds-plugins#cds-plugin-packages) providing out-of-the box support for automatic capturing, storing, and viewing of the change records of modeled entities.

## Table of Contents

- [About this project](#about-this-project)
  - [Table of Contents](#table-of-contents)
- [Usage](#usage)
  - [Add the CDS Plugin](#add-the-cds-plugin)
  - [Annotate with `@changelog`](#annotate-with-changelog)
    - [Human-readable Types and Fields](#human-readable-types-and-fields)
    - [Human-readable IDs](#human-readable-ids)
    - [Human-readable Values](#human-readable-values)
  - [Test-drive locally](#test-drive-locally)
  - [Change History view](#change-history-view)
  - [Customizations](#customizations)
- [Support, Feedback, Contributing](#support-feedback-contributing)
- [Code of Conduct](#code-of-conduct)
- [Licensing](#licensing)


# Usage

In this guide, we use the [Incidents Management reference sample app](https://github.com/cap-js/incidents-app) as the base to add change tracking to.

## Add the CDS Plugin

To enable change tracking, simply add this self-configuring plugin package to your project:

```sh
npm add @cap-js/change-tracking
```

## Annotate with `@changelog`

Next, we need to identify what should be change-tracked by annotating respective entities and elements in our model with the `@changelog` annotation.

Following the [best practice of separation of concerns](https://cap.cloud.sap/docs/guides/domain-modeling#separation-of-concerns), we do so in a separate file _srv/change-tracking.cds_:

```cds
using {
  sap.capire.incidents as my,
  ProcessorService
} from './processor-service';

annotate my.Incidents with @title: 'Incidents';
annotate my.Conversations with @title: 'Conversations';
annotate my.Customers with @title: '{i18n>Customers}';

annotate ProcessorService.Incidents {
  customer @changelog: [customer.name];
  title    @changelog;
  status   @changelog;
}

annotate ProcessorService.Conversations with @changelog: [author, timestamp] {
  message  @changelog @Common.Label: 'Message';
}
```

The minimal annotation we require for change tracking is `@changelog` on an element. An annotation on the entity is not required.

Additional identifiers or labels may be necessary to obtain more *human-readable* change records. These are described below.

Note, that for all annotations, the common i18n rules apply.


### Human-readable Types and Fields

To obtain human-readable columns *Field* and *Object Type*, one can annotate with `@Common.Label` or `@title`.

For example, if were to not annotate the `my.Conversations` with a title and change the `message` property, the *Object Type* column would show the raw entity name:

<img width="1300" alt="change-history-type" src="_assets/changes-type-wbox.png">

As this is long and contains much redundancy, we annotate with a title for a better human-readable *Object Type*:

<img width="1300" alt="change-history-type-hr" src="_assets/changes-type-hr-wbox.png">


### Human-readable IDs

The changelog annotations for *Object ID* and *Parent Object ID* are defined at entity level.

These are already human-readable by default, unless the `@changelog` definition cannot be uniquely mapped such as types `enum` or `Association`.

For example, if we were to only add the `@changelog` annotation without any additional identifiers and change the `message` property, we would obtain simple entity IDs:

```cds
annotate ProcessorService.Conversations {
```
<img width="1300" alt="change-history-id" src="_assets/changes-id-wbox.png">

However, this is not advisable as we cannot easily distinguish between changes. It is more appropriate to annotate as follows:

```cds
annotate ProcessorService.Conversations with @changelog: [author, timestamp] {
```
<img width="1300" alt="change-history-id-hr" src="_assets/changes-id-hr-wbox.png">

By expanding our changelog annotation by the additional identifiers `[author, timestamp]`, we can now better identify the `message` change events by their respective author and timestamp.


### Human-readable Values

The changelog annotations for *New Value* and *Old Value* are defined at element level.

They are already human-readable by default, unless the `@changelog` definition cannot be uniquely mapped such as types `enum` or `Association`.

For example, if we were to only add the `@changelog` annotation on `ProcessorService.Incidents.message` without any additional identifiers on the element level and change the `message` property, we would only see UUIDs displayed in the value columns:

```cds
  customer @changelog;
```

<img width="1300" alt="change-history-value" src="_assets/changes-value-wbox.png">

Hence, here it is essential to add a unique identifier to obtain human-readable value columns:

```cds
  customer @changelog: [customer.name];
```

<img width="1300" alt="change-history-value-hr" src="_assets/changes-value-hr-wbox.png">


## Test-drive locally

With the steps above, we have successfully set up change tracking for our reference application. Let's see that in action.

1. **Start the server**:
  ```sh
  cds watch
  ```
2. **Make a change** on your change-tracked elements. This change will automatically be persisted in the database table (`sap.changelog.ChangeLog`) and made available in a pre-defined view, namely the [Change History view](#change-history-view) for your convenience.

## Change History view

<img width="1300" alt="change-history" src="_assets/changes.png">

If you have a Fiori Element application, the CDS plugin automatically provides and generates a view `sap.changelog.ChangeView`, the facet of which is automatically added to the Fiori Object Page of your change-tracked entities/elements. In the UI, this corresponds to the *Change History* table which serves to help you to view and search the stored change records of your modeled entities.

## Customizations

The view can be easily adapted and configured to your own needs by simply changing or extending it. For example, let's assume we only want to show the first 5 columns in equal spacing, we would extend `srv/change-tracking.cds` as follows:

```cds
using from '@cap-js/change-tracking';

annotate sap.changelog.ChangeView with @(
  UI.LineItem : [
    { Value: modification, @HTML5.CssDefaults: { width:'20%' }},
    { Value: createdAt,    @HTML5.CssDefaults: { width:'20%' }},
    { Value: createdBy,    @HTML5.CssDefaults: { width:'20%' }},
    { Value: entity,       @HTML5.CssDefaults: { width:'20%' }},
    { Value: objectID,     @HTML5.CssDefaults: { width:'20%' }}
  ]
);
```

In the UI, the *Change History* table now contains 4 equally-spaced columns with the desired properties:

<img width="1300" alt="change-history-custom" src="_assets/changes-custom.png">

For more information and examples on adding Fiori Annotations, see [Adding SAP Fiori Annotations](https://cap.cloud.sap/docs/advanced/fiori#fiori-annotations).


# Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/cap-js/change-tracking/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).


# Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](CODE_OF_CONDUCT.md) at all times.


# Licensing

Copyright 2023 SAP SE or an SAP affiliate company and contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/cap-js/change-tracking).
