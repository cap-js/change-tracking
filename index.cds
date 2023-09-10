using {
  managed,
  cuid
} from '@sap/cds/common';

namespace sap.changelog;

/**
 * Used in cds-plugin.js as template for tracked entities
 */
aspect aspect @(UI.Facets: [{
  $Type : 'UI.ReferenceFacet',
  ID    : 'ChangeHistoryFacet',
  Label : '{i18n>ChangeHistoryList}',
  Target: 'changes/@UI.PresentationVariant'
}]) {
  changes : Association to many ChangeLog
              on changes.entityKey = ID;
  key ID  : UUID;
}

type Changes {
  // TODO: Which of these is the Business meaningful object id?
  entityKey        : String @title: '{i18n>Changes.entityID}';
  keys             : String @title: '{i18n>Changes.keys}';
  attribute        : String @title: '{i18n>Changes.attribute}';
  valueChangedFrom : String @title: '{i18n>Changes.valueChangedFrom}';
  valueChangedTo   : String @title: '{i18n>Changes.valueChangedTo}';

  @title: '{i18n>Changes.modification}'
  modification     : String enum {
    create = 'Create';
    update = 'Edit';
    delete = 'Delete';
  };
}

//TODO: Move Business meaingful key to ChangeLog Table
@cds.autoexpose
entity ChangeLog : managed, cuid {
  entity        : String @title: '{i18n>ChangeLog.entity}';
  entityKey     : UUID   @title: '{i18n>ChangeLog.entityKey}';
  serviceEntity : String @title: '{i18n>ChangeLog.serviceEntity}';
  changes       : many Changes;
}

// annotate ChangeLog actions {
//     @(
//         Common.SideEffects : {
//             TargetProperties : ['_it/entityKey'],
//             TargetEntities : [_it]
//         },
//         cds.odata.bindingparameter.name : '_it'
//     )
//     listChanges(entityKey @(
//         title : '{i18n>listChanges}',
//         Common : {ValueListMapping : {
//             Label : '{i18n>Changes}',
//             CollectionPath : 'Changes',
//             Parameters : [
//                 {
//                     $Type : 'Common.ValueListParameterInOut',
//                     LocalDataProperty : order_ID,
//                     ValueListProperty : 'ID'
//                 },
//                 {
//                     $Type : 'Common.ValueListParameterDisplayOnly',
//                     ValueListProperty : 'OrderNo'
//                 },
//                 {
//                     $Type : 'Common.ValueListParameterDisplayOnly',
//                     ValueListProperty : 'createdBy'
//                 },
//                 {
//                     $Type : 'Common.ValueListParameterDisplayOnly',
//                     ValueListProperty : 'createdAt'
//                 }
//             ],
//         }}
//     ),
//     quantity @title : '{i18n>Quantity}'
//     )
// }

annotate ChangeLog with @(UI: {
  PresentationVariant: {
    Visualizations: ['@UI.LineItem'],
    RequestAtLeast: [
      entityKey,
      entity
    ],
    SortOrder     : [{
      Property  : createdAt,
      Descending: true
    }],
    GroupBy       : [ createdBy ]
  },
  LineItem           : [
    { Value: entity },
    { Value: createdBy },
    { Value: createdAt },
    {
      $Type : 'UI.DataFieldForAction',
      Action: 'ChangeLog.listChanges',
      Label: '{i18n>listChanges}',
      Inline: true,
      Determining: true,
      IconUrl: 'sap-icon://open-command-field'
    }
  // { Value: keys },
  // { Value: attribute },
  // { Value: valueChangedFrom },
  // { Value: valueChangedTo },
  // { Value: entityName },
  // { Value: serviceEntity },
  // { Value: changes}
  ],
  DeleteHidden       : true,
});
