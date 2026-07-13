using {sap.change_tracking as my} from '../db/index';
using {sap.changelog as change} from '@cap-js/change-tracking';

service VariantTesting {
  @cds.redirection.target
  entity DifferentFieldTypes as projection on my.DifferentFieldTypes;

  entity GrandRootSample as projection on my.GrandRootSample;
  entity RootSample as projection on my.RootSample;
  entity Level1Sample as projection on my.Level1Sample;
  entity Level2Sample as projection on my.Level2Sample;

  @odata.draft.enabled
  entity TrackingComposition as projection on my.TrackingComposition;

  entity ComposedEntities        as projection on my.ComposedEntities;
  entity ExplicitCompositionOne  as projection on my.ExplicitCompositionOne;
  entity ExplicitCompositionMany as projection on my.ExplicitCompositionMany;

  entity CompositeKeyParent as projection on my.CompositeKeyParent;

  entity ObjectIdFallbackParent as projection on my.ObjectIdFallbackParent;

  entity ChangeView as projection on change.ChangeView;

  @changelog: false
  entity NotTrackedDifferentFieldTypes as projection on my.DifferentFieldTypes;


  entity SelectionView as select from my.DifferentFieldTypes;

  entity ExtendedEvents as select from my.ExtendedEvents;
  entity DataExtractionSummaryView as select from my.DataExtractionSummaryView;

  entity CustomTypeKeyTable as projection on my.CustomTypeKeyTable;

  entity Employees as projection on my.Employees;

  entity EmployeesExpr as projection on my.EmployeesExpr;

  entity EmployeesNestedExpr as projection on my.EmployeesNestedExpr;

  entity EmployeesFuncExpr as projection on my.EmployeesFuncExpr;

  // Test for DB-level view shadowing the composition parent mapping
  entity VersionWithAssignments as projection on my.VersionWithAssignments;
  entity VersionAssignment       as projection on my.VersionAssignment;

  entity ServiceLevelTimezoneRenamed as projection on my.DifferentFieldTypes {
    ID,
    srvRenamedDateTimeWDTZ as renamedDateTime,
    timeZone as renamedTimeZone
  };

  entity ServiceOnlyTimezoneRenamed as projection on my.DifferentFieldTypes {
    ID,
    plainDateTime as renamedPlain,
    timeZone as renamedTimezone
  };
}

// Test: changes facet nested in CollectionFacet targeting changes/@UI.LineItem — plugin must not add a duplicate
annotate VariantTesting.RootSample with @(UI.Facets: [{
  $Type  : 'UI.CollectionFacet',
  ID     : 'TestCollection',
  Label  : 'Test Collection',
  Facets : [{
    $Type  : 'UI.ReferenceFacet',
    ID     : 'CustomChangesFacet',
    Label  : 'Custom Changes',
    Target : 'changes/@UI.LineItem',
  }]
}]);

// Test: changes facet nested in CollectionFacet targeting changes/@UI.PresentationVariant — plugin must not add a duplicate
annotate VariantTesting.DifferentFieldTypes with @(UI.Facets: [{
  $Type  : 'UI.CollectionFacet',
  ID     : 'TestCollection',
  Label  : 'Test Collection',
  Facets : [{
    $Type  : 'UI.ReferenceFacet',
    ID     : 'CustomChangesFacet',
    Label  : 'Custom Changes',
    Target : 'changes/@UI.PresentationVariant',
  }]
}]);

// Test: changes facet nested three levels deep in CollectionFacets — plugin must not add a duplicate
annotate VariantTesting.CompositeKeyParent with @(UI.Facets: [{
  $Type  : 'UI.CollectionFacet',
  ID     : 'Level1',
  Label  : 'Level 1',
  Facets : [{
    $Type  : 'UI.CollectionFacet',
    ID     : 'Level2',
    Label  : 'Level 2',
    Facets : [{
      $Type  : 'UI.CollectionFacet',
      ID     : 'Level3',
      Label  : 'Level 3',
      Facets : [{
        $Type  : 'UI.ReferenceFacet',
        ID     : 'CustomChangesFacet',
        Label  : 'Custom Changes',
        Target : 'changes/@UI.PresentationVariant',
      }]
    }]
  }]
}]);

// Test: service-level-only @changelog on elements that have @Common.Timezone at DB level
annotate VariantTesting.DifferentFieldTypes with {
  srvDateTimeWTZ  @changelog;
  srvDateTimeWDTZ @changelog;
};

// Test: service-level-only @changelog + @Common.Timezone on renamed columns
annotate VariantTesting.ServiceLevelTimezoneRenamed with {
  renamedDateTime @changelog @Common.Timezone : renamedTimeZone;
};

// Test: service-level-only @changelog AND @Common.Timezone on a renamed column.
// DB element 'plainDateTime' has no @Common.Timezone of its own.
annotate VariantTesting.ServiceOnlyTimezoneRenamed with {
  renamedPlain @changelog @Common.Timezone : renamedTimezone;
};

// Simulates a downstream extension that adds @changelog paths pointing at
// a @PersonalData field on the base model. The base Employees entity has
// no @changelog annotations on its own.
annotate VariantTesting.Employees with @(changelog: [manager.salary]) {
  manager @changelog: [manager.salary];
  officeLocation @changelog;
};

// Same scenario but with expression-based @changelog annotations.
// Expressions referencing @PersonalData fields must also be rejected.
annotate VariantTesting.EmployeesExpr with @(changelog: [('Manager earns ' || manager.salary)]) {
  manager @changelog: [('Salary: ' || manager.salary)];
  officeLocation @changelog;
};

// Same scenario but the @PersonalData ref is nested inside a sub-expression.
// The ref walker must recurse into nested xpr tokens to catch it.
annotate VariantTesting.EmployeesNestedExpr with @(changelog: [('Manager earns ' || ('' || manager.salary))]) {
  manager @changelog: [('Salary: ' || ('' || manager.salary))];
  officeLocation @changelog;
};

// Same scenario but the @PersonalData ref is hidden inside a function call's
// arguments. The ref walker must recurse into token.args to catch it.
annotate VariantTesting.EmployeesFuncExpr with @(changelog: [('Manager earns ' || coalesce(manager.salary, 0))]) {
  manager @changelog: [('Salary: ' || coalesce(manager.salary, 0))];
  officeLocation @changelog;
};

// Test: DB-level view shadowing the composition parent mapping.
// VersionsForLock (select * from VersionWithAssignments) inherits the 'assignments'
// composition and overwrites the child->parent map entry in analyzeCompositions.
// The trigger for VersionAssignment must still emit the cds.Composition parent INSERT
// wired to the actual VersionWithAssignments table (not the view).
annotate VariantTesting.VersionWithAssignments with @changelog: [title] {
  title @changelog;
};

annotate VariantTesting.VersionAssignment with {
  version @changelog: [version.title];
  tag     @changelog;
};
