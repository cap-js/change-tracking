using from './change-logs';
using from './joins-and-unions';
using from './batch-inserts';
using {cuid} from '@sap/cds/common';


namespace sap.change_tracking;

@title: 'Different field types'
entity DifferentFieldTypes : cuid {
      title     : String      @changelog;
      largeText : LargeString @changelog;
      dateTime  : DateTime;
      dateTimeWTZ  : DateTime @changelog @Common.Timezone : 'Europe/Berlin';
      dateTimeWDTZ  : DateTime @changelog @Common.Timezone : timeZone;
      timeZone: String default 'Europe/Berlin' @Common.IsTimezone;
      timestamp : Timestamp;
      number    : Decimal;
      numberWithScale : Decimal(11, 4);
      bool      : Boolean;
      image     : LargeBinary @changelog; // Unsupported - should trigger warning
      icon      : Binary      @changelog; // Unsupported - should trigger warning
      dppField1 : String      @PersonalData.IsPotentiallyPersonal;
      dppField2 : String      @PersonalData.IsPotentiallySensitive;
      dppField3 : String      @PersonalData.FieldSemantics: 'DataControllerID';
      // Elements for testing @Common.Timezone with service-level-only @changelog
      srvDateTimeWTZ          : DateTime @Common.Timezone : 'Europe/Berlin';
      srvDateTimeWDTZ         : DateTime @Common.Timezone : timeZone;
      srvRenamedDateTimeWDTZ  : DateTime @Common.Timezone : timeZone;
      plainDateTime           : DateTime;
      @changelog: false
      children  : Composition of many DifferentFieldTypesChildren
                    on children.parent = $self;
      nonExistent : Association to one NonExistentTable @changelog: [nonExistent.name]; // Unsupported - should trigger warning
}

entity DifferentFieldTypesChildren : cuid {
      parent : Association to one DifferentFieldTypes;
      double : Double;
}

// Test for 4-level composition hierarchy: GrandRootSample -> RootSample -> Level1Sample -> Level2Sample
entity GrandRootSample {
  key ID       : String;
      children : Composition of many RootSample
                   on children.grandParent = $self;
      title    : String @title: 'GrandRoot Sample Title';
}

// Test for key which include special character: '/' -- draft disabled
entity RootSample {
  key ID          : String;
      grandParent : Association to one GrandRootSample;
      children    : Composition of many Level1Sample
                      on children.parent = $self;
      title       : String @title: 'Root Sample Title';
}

entity Level1Sample {
  key ID       : String;
      parent   : Association to one RootSample;
      children : Composition of many Level2Sample
                   on children.parent = $self;
      title    : String @title: 'Level1 Sample Title';
}

entity Level2Sample {
  key ID     : String;
      title  : String @title: 'Level2 Sample Title';
      order  : Integer;
      parent : Association to one Level1Sample;
}

// By intent no @changelog on the entity level
@title: '{i18n>bookStore.objectTitle}'
entity TrackingComposition : cuid {
      name                 : String;
      children             : Composition of many ComposedEntities
                               on children.parent = $self;
      childrenAspectOne    : Composition of one CompositionAspect;
      childrenAspectMany   : Composition of many CompositionAspect;
      childrenExplicitOne  : Composition of one ExplicitCompositionOne
                               on childrenExplicitOne.parent = $self;
      childrenExplicitMany : Composition of many ExplicitCompositionMany
                               on childrenExplicitMany.parent = $self;
}

aspect CompositionAspect : cuid {
      aspect : String;
}

entity ExplicitCompositionOne : cuid {
      parentID : UUID;
      parent   : Association to one TrackingComposition
                   on parent.ID = parentID;
      title    : String;
      price    : Decimal;
}

entity ExplicitCompositionMany : cuid {
      parentID : UUID;
      parent   : Association to one TrackingComposition
                   on parent.ID = parentID;
      title    : String;
      price    : Decimal;
}

// By intent no @changelog on the entity level
@title: '{i18n>books.objectTitle}'
entity ComposedEntities : cuid {
      parent : Association to one TrackingComposition;
      title  : String;
      price  : Decimal;
}

entity CompositeKeyParent {
  key year  : Integer;
  key code  : String;
      title : String;
      items : Composition of many {
        key ID    : UUID;
            value : String;
      };
}

@changelog: [title]
entity ObjectIdFallbackParent : cuid {
  title    : String @changelog;
  @changelog
  children : Composition of many ObjectIdFallbackChild
                 on children.parent = $self;
}

@changelog: [fieldA, fieldB]
entity ObjectIdFallbackChild : cuid {
  parent   : Association to one ObjectIdFallbackParent;
  fieldA   : String @changelog;
  fieldB   : String @changelog;
  name     : String @changelog;
}

@cds.persistence.skip
entity NonExistentTable : cuid {
      name : String;
}

entity CustomTypeKeyTable {
  key abc : CustomType;
      name : String;
      timezone : String default 'Asia/Riyadh' @Common.IsTimezone @changelog;
}

type CustomType : Association to one TrackingComposition;

// DB-level view (select *) shadowing the composition parent mapping
//
// VersionWithAssignments has a composition 'assignments' pointing to VersionAssignment
// VersionsForLock is a DB-level view that inherits the same composition
entity VersionWithAssignments : cuid {
      title       : String;
      assignments : Composition of many VersionAssignment
                      on assignments.version = $self;
}

entity VersionAssignment : cuid {
      version : Association to one VersionWithAssignments @changelog: [version.title];
      tag     : String @changelog;
}

// DB-level view that inherits the 'assignments' composition from VersionWithAssignments
entity VersionsForLock as select from VersionWithAssignments { * };

// `salary` is @PersonalData; a leaky @changelog annotation is applied in
// feature-testing.cds. The Expr variants differ only in how deeply their
// annotation nests the manager.salary ref.
entity Employees : cuid {
      name           : String;
      officeLocation : String;
      salary         : Decimal @PersonalData.IsPotentiallyPersonal;
      manager        : Association to Employees;
}

// top-level expression
entity EmployeesExpr : Employees {
  manager : Association to EmployeesExpr;
}

// ref nested in a sub-expression
entity EmployeesNestedExpr : Employees {
  manager : Association to EmployeesNestedExpr;
}

// ref nested in function-call arguments
entity EmployeesFuncExpr : Employees {
  manager : Association to EmployeesFuncExpr;
}
