using {
  managed,
  cuid
} from '@sap/cds/common';

namespace sap.changelog;

/**
 * Used in cds-plugin.js as template for tracked entities
 */
@cds.persistence.skip
entity aspect @(UI.Facets: [{
  $Type            : 'UI.ReferenceFacet',
  ID               : 'ChangeHistoryFacet',
  Label            : '{i18n>ChangeHistory}',
  Target           : 'changes/@UI.PresentationVariant',
  @UI.PartOfPreview: false
}]) {
      changes : Association to many ChangeView
                  on  changes.entityKey = ID
                  and changes.entity    = 'ENTITY';
  key ID      : String;
}


// This is a helper view to flatten the assoc path to the entityKey
// Locale fallback: tries exact locale first (e.g., en_GB), then falls back to 'en'
// REVISIT: When dropping CDS 8 support, use base locale extraction instead of hardcoded 'en' fallback:
//   substring($user.locale, 0, (case when indexof($user.locale, '_') >= 0 then indexof($user.locale, '_') else length($user.locale) end))
//   This would extract 'en' from 'en_GB', 'de' from 'de_DE', etc. (indexof was introduced in CDS 9)
@readonly
@cds.autoexpose
view ChangeView as
  select from Changes as change
  left outer join i18nKeys as attributeI18n
    on  attributeI18n.ID     = change.attribute
    and attributeI18n.locale = $user.locale
  left outer join i18nKeys as entityI18n
    on  entityI18n.ID     = change.entity
    and entityI18n.locale = $user.locale
  left outer join i18nKeys as modificationI18n
    on  modificationI18n.ID     = change.modification
    and modificationI18n.locale = $user.locale
  left outer join i18nKeys as fallbackAttributeI18n
    on  not                          exists(
      select distinct locale from i18nKeys
      where
        locale = $user.locale
    )
    and fallbackAttributeI18n.locale = 'en'
    and fallbackAttributeI18n.ID     = change.attribute
  left outer join i18nKeys as fallbackEntityI18n
    on  not                       exists(
      select distinct locale from i18nKeys
      where
        locale = $user.locale
    )
    and fallbackEntityI18n.locale = 'en'
    and fallbackEntityI18n.ID     = change.entity
  left outer join i18nKeys as fallbackModificationI18n
    on  not                             exists(
      select distinct locale from i18nKeys
      where
        locale = $user.locale
    )
    and fallbackModificationI18n.locale = 'en'
    and fallbackModificationI18n.ID     = change.modification
  {
    key change.ID                                     @UI.Hidden,
        change.parent                  : redirected to ChangeView,
        change.children                : redirected to ChangeView,
        change.attribute,
        change.valueChangedFrom,
        change.valueChangedTo,
        change.entity,
        change.entityKey,
        change.objectID,
        change.modification,
        change.valueDataType,
        change.createdAt,
        change.createdBy,
        change.transactionID,
        COALESCE(
          attributeI18n.text, fallbackAttributeI18n.text, change.attribute
        )    as attributeLabel         : String(15)   @title: '{i18n>Changes.attribute}',
        COALESCE(
          entityI18n.text, fallbackEntityI18n.text, change.entity
        )    as entityLabel            : String(24)   @title: '{i18n>Changes.entity}',
        COALESCE(
          modificationI18n.text, fallbackModificationI18n.text, change.modification
        )    as modificationLabel      : String(16)   @title: '{i18n>Changes.modification}',
        COALESCE(
          change.valueChangedFromLabel, change.valueChangedFrom
        )    as valueChangedFromLabel  : String(5000) @(title: '{i18n>Changes.valueChangedFrom}', UI.MultiLineText),
        COALESCE(
          change.valueChangedToLabel, change.valueChangedTo
        )    as valueChangedToLabel    : String(5000) @(title: '{i18n>Changes.valueChangedTo}', UI.MultiLineText),
        // For the hierarchy
        null as LimitedDescendantCount : Int16        @UI.Hidden,
        null as DistanceFromRoot       : Int16        @UI.Hidden,
        null as DrillState             : String       @UI.Hidden,
        null as LimitedRank            : Int16        @UI.Hidden,
  };

entity i18nKeys {
  key ID     : String(5000);
  key locale : String(100);
      text   : String(5000);
}

// Dummy table necessary for HANA triggers
@cds.persistence.skip
entity CHANGE_TRACKING_DUMMY {
  key X : String(5);
}

entity Changes : cuid {
  parent                : Association to one Changes;
  children              : Composition of many Changes
                            on children.parent = $self;

  attribute             : String(127)       @title: '{i18n>Changes.attribute}';
  valueChangedFrom      : String(5000)      @title: '{i18n>Changes.valueChangedFrom}'  @UI.MultiLineText;
  valueChangedTo        : String(5000)      @title: '{i18n>Changes.valueChangedTo}'    @UI.MultiLineText;
  valueChangedFromLabel : String(5000)      @title: '{i18n>Changes.valueChangedFrom}';
  valueChangedToLabel   : String(5000)      @title: '{i18n>Changes.valueChangedTo}';

  entity                : String(150)       @UI.Hidden; // target entity on db level
  entityKey             : String(5000)      @title: '{i18n>Changes.entityKey}'; // primary key of target entity

  // Business meaningful object id
  objectID              : String(5000)      @title: '{i18n>Changes.objectID}';

  @title: '{i18n>Changes.modification}'
  modification          : String(6) enum {
    Create = 'create';
    Update = 'update';
    Delete = 'delete';
  };

  valueDataType         : String(5000)      @title: '{i18n>Changes.valueDataType}'     @UI.Hidden;
  createdAt             : managed:createdAt @title: '{i18n>Changes.createdAt}';
  createdBy             : managed:createdBy @title: '{i18n>Changes.createdBy}';
  transactionID         : Int64             @title: '{i18n>Changes.transactionID}';
}

annotate ChangeView with @(UI: {
  PresentationVariant #ChangeHierarchy: {RecursiveHierarchyQualifier: 'ChangeHierarchy',
  },
  PresentationVariant                 : {
    Visualizations: ['@UI.LineItem'],
    SortOrder     : [{
      Property  : createdAt,
      Descending: true
    }],
  },
  HeaderInfo                          : {
    $Type         : 'UI.HeaderInfoType',
    TypeName      : '{i18n>ChangeHistory}',
    TypeNamePlural: '{i18n>ChangeHistory}',
  },
  LineItem                            : [
    {
      Value         : modificationLabel,
      @UI.Importance: #Low
    },
    {
      Value         : entityLabel,
      @UI.Importance: #Medium
    },
    {
      Value         : objectID,
      @UI.Importance: #Medium
    },
    {
      Value         : attributeLabel,
      @UI.Importance: #Medium
    },
    {
      Value         : valueChangedToLabel,
      @UI.Importance: #High
    },
    {
      Value         : valueChangedFromLabel,
      @UI.Importance: #High
    },
    {
      Value         : createdAt,
      @UI.Importance: #Low
    },
    {
      Value         : createdBy,
      @UI.Importance: #High
    },
  ],
  DeleteHidden                        : true,
}) {
  valueChangedFrom @UI.Hidden;
  valueChangedTo   @UI.Hidden;
  parent           @UI.Hidden;
  entityKey        @UI.Hidden;
  entity           @UI.Hidden;
  attribute        @UI.Hidden;
};

annotate ChangeView with @(
  Aggregation.RecursiveHierarchy #ChangeHierarchy        : {
    ParentNavigationProperty: parent, // navigates to a node's parent
    NodeProperty            : ID, // identifies a node, usually the key
  },
  Hierarchy.RecursiveHierarchyActions #ChangeHierarchy   : {ChangeSiblingForRootsSupported: false,
  },
  Hierarchy.RecursiveHierarchy #ChangeHierarchy          : {
    LimitedDescendantCount: LimitedDescendantCount,
    DistanceFromRoot      : DistanceFromRoot,
    DrillState            : DrillState,
    LimitedRank           : LimitedRank
  },
  // Disallow filtering on these properties from Fiori UIs
  Capabilities.FilterRestrictions.NonFilterableProperties: [
    'LimitedDescendantCount',
    'DistanceFromRoot',
    'DrillState',
    'LimitedRank'
  ],
  // Disallow sorting on these properties from Fiori UIs
  Capabilities.SortRestrictions.NonSortableProperties    : [
    'LimitedDescendantCount',
    'DistanceFromRoot',
    'DrillState',
    'LimitedRank'
  ],
);

// Annotations for searching
annotate ChangeView with @(cds.search: {
  valueChangedFrom: false,
  valueChangedTo  : false,
  entity          : false,
  attribute       : false,
  modification    : false,
  valueDataType   : false,
  modificationLabel,
  entityLabel,
  entityKey,
  objectID,
  attributeLabel,
  valueChangedFromLabel,
  valueChangedToLabel,
  createdBy,
  transactionID
}) {
  entityLabel       @Search.ranking: HIGH;
  attributeLabel    @Search.ranking: HIGH;
  objectID          @Search.ranking: HIGH;

  entityKey         @Search.ranking: LOW;
  transactionID     @Search.ranking: LOW;
  modificationLabel @Search.ranking: LOW;
};
