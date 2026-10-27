import { emailCustomerDocument } from '../../../../_lib/document-email.js';

export const onRequestPost = context => emailCustomerDocument(context);
