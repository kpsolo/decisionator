import { setupServer } from "msw/node";
import { googleHandlers } from "./handlers.js";

export const fakeGoogleServer = setupServer(...googleHandlers);
export { fakeGoogleState } from "./state.js";
export { googleHandlers } from "./handlers.js";
