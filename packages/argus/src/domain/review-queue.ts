export const REVIEW_QUEUES = ["findings", "context", "documentation"] as const;
export type ReviewQueue = (typeof REVIEW_QUEUES)[number];
