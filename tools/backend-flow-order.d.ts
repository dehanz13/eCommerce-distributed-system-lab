/** Order sanitized operator observations without changing the supplied snapshot; no I/O. */
export function orderedActivity<
  T extends {
    id: string;
    owner: string;
    type: string;
    occurredAt: string;
    streamId?: string;
    sequence?: number;
    publicationId?: string;
    deliveryId?: string;
  },
>(records: T[]): T[];
