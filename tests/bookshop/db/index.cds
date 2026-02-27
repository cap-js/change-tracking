using from './change-logs';

namespace sap.change_tracking;

@title: 'Different field types'
entity DifferentFieldTypes {
  key ID        : UUID;
      title     : String @changelog;
      largeText : LargeString @changelog;
      dateTime  : DateTime;
      timestamp : Timestamp;
      number    : Decimal;
      bool      : Boolean;
      image     : LargeBinary @changelog;  // Unsupported - should trigger warning
      icon      : Binary @changelog;       // Unsupported - should trigger warning
      dppField1 : String @PersonalData.IsPotentiallyPersonal;
      dppField2 : String @PersonalData.IsPotentiallySensitive;
      children  : Composition of many DifferentFieldTypesChildren
                    on children.parent = $self;
}

entity DifferentFieldTypesChildren {
  key ID     : UUID;
      parent : Association to one DifferentFieldTypes;
      double : Double;
}

// Test for key which include special character: '/' -- draft disabled
entity RootSample {
  key ID       : String;
      children : Composition of many Level1Sample
                   on children.parent = $self;
      title    : String @title: 'Root Sample Title';
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
      parent : Association to one Level1Sample;
}

// By intent no @changelog on the entity level
@title: '{i18n>bookStore.objectTitle}'
entity TrackingComposition {
  key ID       : UUID;
      children : Composition of many ComposedEntities
                   on children.parent = $self;
}

// By intent no @changelog on the entity level
@title: '{i18n>books.objectTitle}'
entity ComposedEntities {
  key ID     : UUID;
      parent : Association to one TrackingComposition;
      title  : String;
      price  : Decimal;
}
