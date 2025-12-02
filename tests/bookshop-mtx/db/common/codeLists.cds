using {sap.common.CodeList as CodeList} from '@sap/cds/common';

namespace sap.capire.common.codelists;

entity LifecycleStatusCodes : CodeList {
    key code        : String(2);
        criticality : Integer;
}

entity BookTypeCodes : CodeList {
    key code : String(3);
}

entity ActivationStatusCode : CodeList {
    key code : String(20);
}
