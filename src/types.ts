export interface Meeting {
  id?: string;
  title: string;
  hostId: string;
  hostName: string;
  createdAt: string;
}

export interface Attendee {
  id?: string;
  userId: string;
  userName: string;
  userEmail: string;
  bloco: string;
  apartamento: string;
  signedAt: string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}
