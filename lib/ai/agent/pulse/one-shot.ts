import type {SignalFamily} from './types';
import type {ProactiveCandidate} from './privacy';
import type {ONE_SHOT_VERSION,OneShotReason,OneShotStatus} from './privacy';
export {ONE_SHOT_VERSION,ONE_SHOT_REASONS,oneShotFingerprint,oneShotParents,buildOneShotContext} from './privacy';
export type {OneShotReason,OneShotStatus} from './privacy';

export interface OneShotBinding {
 id:string;ownerId:string;projectId:string;parentId:string;contentRevision:number;episode:number;family:SignalFamily;
 sourceToken:string;provider:'gemini';model:string;slot:string;expiresAt:string;settingsRevision:number;
 authorizationVersion:typeof ONE_SHOT_VERSION;contextPolicyVersion:typeof ONE_SHOT_VERSION;contextFingerprint:string;
}
export interface OneShotParent extends ProactiveCandidate {contentRevision:number;attemptCount:number;attemptTerminal:boolean}
export interface OneShotAccounting {
 allowanceConsumed:boolean;sendAttempted:boolean;transport:'not_started'|'unknown'|'confirmed';responseReceived:boolean;
 output:'none'|'accepted'|'rejected';publicationCompleted:boolean;
}
export interface OneShotAuthorization extends OneShotBinding {
 status:OneShotStatus;reason:OneShotReason|null;createdAt:string;consumedAt:string|null;terminalAt:string|null;accounting:OneShotAccounting;
}
export interface OneShotPreview {previewIdentity:string;binding:OneShotBinding;context:string;projectTitle:string;signalTitle:string;evidenceValidUntil:string}
export interface OneShotAdmission {authorizationId:string;credential:string}
export interface OneShotProvider {configured:boolean;provider:string;model:string}
