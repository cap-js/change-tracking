namespace sap.sme.changelog;

using {
  managed,
  cuid
} from '@sap/cds/common';

entity Changes : managed, cuid {
  @title            : '{i18n>Changes.keys}'
  @Core.Immutable
  keys              : String;

  @title            : '{i18n>Changes.attribute}'
  @Core.Immutable
  attribute         : String;

  @title            : '{i18n>Changes.valueChangedFrom}'
  @Core.Immutable
  valueChangedFrom  : String;

  @title            : '{i18n>Changes.valueChangedTo}'
  @Core.Immutable
  valueChangedTo    : String;

  // Business meaningful object id
  @title            : '{i18n>Changes.entityID}'
  @Core.Immutable
  entityID          : String;

  @title            : '{i18n>Changes.entity}'
  @Core.Immutable
  entity            : String;

  @title            : '{i18n>Changes.serviceEntity}'
  @Core.Immutable
  serviceEntity     : String;

  // Business meaningful parent object id
  @title            : '{i18n>Changes.parentEntityID}'
  @Core.Immutable
  parentEntityID    : String;

  @title            : '{i18n>Changes.parentKey}'
  @Core.Immutable
  parentKey         : UUID;

  @title            : '{i18n>Changes.serviceEntityPath}'
  @Core.Immutable
  serviceEntityPath : String;

  @title            : '{i18n>Changes.modification}'
  @Core.Immutable
  modification      : String enum {
    create = 'Create';
    update = 'Edit';
    delete = 'Delete';
  };

  @title            : '{i18n>Changes.valueDataType}'
  @Core.Immutable
  valueDataType     : String;

  @title            : '{i18n>ChangeLog.ID}'
  @Core.Immutable
  @assert.integrity : false
  changeLog         : Association to ChangeLog;
}

entity ChangeLog : managed, cuid {
  // DB entity name
  @title            : '{i18n>ChangeLog.entity}'
  @Core.Immutable
  entity        : String;

  @title            : '{i18n>ChangeLog.entityKey}'
  @Core.Immutable
  entityKey     : UUID;

  @title            : '{i18n>ChangeLog.serviceEntity}'
  @Core.Immutable
  serviceEntity : String;

  @Core.Immutable
  @assert.integrity : false
  changes       : Composition of many Changes
                    on changes.changeLog = $self;
}

view ChangeView as
  select from Changes {
    ID                  as ID                @UI.Hidden,
    attribute           as attribute,
    entityID            as objectID,
    entity              as entity,
    serviceEntity       as serviceEntity,
    parentEntityID      as parentObjectID,
    parentKey           as parentKey,
    valueChangedFrom    as valueChangedFrom,
    valueChangedTo      as valueChangedTo,
    modification        as modification,
    createdBy           as createdBy,
    createdAt           as createdAt,
    changeLog.entityKey as entityKey,
    serviceEntityPath   as serviceEntityPath @UI.Hidden,
  };
