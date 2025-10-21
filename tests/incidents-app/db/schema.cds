using { cuid, managed, sap.common.CodeList } from '@sap/cds/common';

namespace sap.capire.incidents;

/**
 * Customers using products sold by our company.
 * Customers can create support Incidents.
 */
@changelog : [name]
entity Customers : managed {
  key ID         : String;
  firstName      : String @changelog;
  lastName       : String @changelog;
  name           : String = firstName ||' '|| lastName;
  email          : EMailAddress @changelog;
  phone          : PhoneNumber  @changelog;
  creditCardNo   : String(16) @assert.format: '^[1-9]\d{15}$';
  addresses      : Composition of many Addresses on addresses.customer = $self;
  incidents      : Association to many Incidents on incidents.customer = $self;
}

entity Addresses : cuid, managed {
  customer       : Association to Customers;
  city           : String;
  postCode       : String;
  streetAddress  : String;
}


/**
 * Incidents created by Customers.
 */
@changelog : [title]
entity Incidents : cuid, managed {
  customer       : Association to Customers @changelog : [customer.name];
  title          : String @title: 'Title';
  urgency        : Association to Urgency default 'M';
  status         : Association to Status default 'N' @changelog : [status.descr];
  date           : Date @title : 'date' @changelog;
  datetime       : DateTime @title : 'datetime' @changelog;
  time           : Time @title : 'time' @changelog;
  timestamp      : Timestamp @title : 'timestamp' @changelog;
  conversation   : Composition of many {
    key ID    : UUID;
    timestamp : type of managed:createdAt;
    author    : type of managed:createdBy;
    message   : String;
  };
  tasks : Composition of many IncidentTasks on tasks.incident = $self;
}

@changelog : [title, timestamp]
entity IncidentTasks : cuid, managed {
  incident    : Association to Incidents;
  title       : String @title: 'Task Title' @changelog;
  description : String @changelog;
}

entity Status : CodeList {
  key code    : String enum {
    new        = 'N';
    assigned   = 'A';
    in_process = 'I';
    on_hold    = 'H';
    resolved   = 'R';
    closed     = 'C';
  };
  criticality : Integer;
}

entity Urgency : CodeList {
  key code : String enum {
    high   = 'H';
    medium = 'M';
    low    = 'L';
  };
}

type EMailAddress : String;
type PhoneNumber  : String;
