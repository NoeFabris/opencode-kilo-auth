import { fetchKiloModels } from "../src/models.js";
import { loadStoredAuth } from "../src/storage.js";

const stored = await loadStoredAuth();
const token = process.env.KILO_API_KEY ?? stored?.token;
const organizationId = process.env.KILO_ORG_ID ?? stored?.organizationId;

const models = await fetchKiloModels({ token, organizationId });
console.log(JSON.stringify(models, null, 2));
