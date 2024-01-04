using {sap.common.CodeList as CodeList} from '@sap/cds/common';

namespace sap.capire.bookshop;

entity PaymentAgreementStatusCodes : CodeList {
  key code : String(10);
}

entity ActivationStatusCode : CodeList {
  key code : String(20);
}
