import { publicProps as base } from './phase6-data';
import { image } from './matrix-data';
export { config, callService, memoryResponse } from './phase6-data';
export const publicProps = { ...base, initialProfessionalContent: { ...base.initialProfessionalContent!, hero: { ...base.initialProfessionalContent!.hero, avatar: image } } };
