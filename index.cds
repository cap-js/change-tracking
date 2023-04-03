using { User } from '@sap/cds/common';
namespace sap.common.changes;

// aspect changelog {
//   changes : Composition of many Changes on changes.entity = $entity.name and changes.ID = $self;
// }

entity ChangeLog {
  key entity : String;
  key ID     : String;
  sid        : String;
  type       : String enum {
    create;
    update;
    delete
  };
  changes    : array of {
    field : String;
    new   : String;
    old   : String;
  };
  user       : User;
  timestamp  : Timestamp;
}
