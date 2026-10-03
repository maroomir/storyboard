// 웹뷰가 번들하는 진입점은 `@storyboard/story-model/contracts` 하나뿐이라, 브라우저에서 필요한
// 표는 그 표를 소유한 패키지에서 여기로 한 번 더 내보낸다. 사본을 만들 이유가 사라진다.
export {
  aiProviderIds,
  getProviderDisplayName,
  listSelectableProviderIds,
  providerCatalog,
  storyboardModelCatalog,
} from '#model/contracts/providerCatalog';
export {
  isSpanRequiredTool,
  studioAgentToolNames,
  studioToolNamesByShape,
} from '#model/contracts/studioAgent';
export { requiresApiKey } from '#model/contracts/ai';
export type { AiProviderId, ProviderModelOption } from '#model/contracts/providerCatalog';
export type { StudioAgentToolName } from '#model/contracts/studioAgent';
export {
  compositionCatalog,
  compositionKindLabels,
  compositionKinds,
  contractFieldKeys,
  contractFieldLabels,
  pointOfViewCatalog,
  pointOfViewLabels,
  pointOfViews,
} from '#model/format/project';
export type {
  CompositionKind,
  ContractFieldKey,
  NarrativeChoiceLabels,
  PointOfView,
} from '#model/format/project';
