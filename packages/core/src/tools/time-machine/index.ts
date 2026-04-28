import { getTokenInfo } from './get-token-info.js';
import { buyMyToken } from './buy-my-token.js';

export const timeMachineChatTools = {
  get_token_info: getTokenInfo,
  buy_my_token: buyMyToken,
} as const;

export const timeMachineChatToolNames = Object.keys(timeMachineChatTools);

export { getTokenInfo, buyMyToken };
