import type {OneShotAccounting,OneShotReason,OneShotStatus} from '@/lib/ai/agent/pulse/one-shot';
export interface OneShotPreviewDto {
 parentId:string;previewIdentity:string;projectTitle:string;signalTitle:string;family:string;reasonCodes:string[];
 contentRevision:number;slot:string;expiresAt:string;evidenceValidUntil:string;provider:'gemini';model:string;
 context:string;maxProviderRequests:1;billingTreatment:'unknown_free';
}
export interface OneShotStatusDto {
 id:string;projectTitle:string;signalTitle:string;status:OneShotStatus;reason:OneShotReason|null;slot:string;expiresAt:string;
 provider:'gemini';model:string;accounting:OneShotAccounting;
}
export interface OneShotListDto {items:OneShotStatusDto[];candidates:OneShotPreviewDto[]}
