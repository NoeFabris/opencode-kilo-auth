import { fetchKiloModels } from "../src/models";

const token = process.env.KILO_API_KEY;
const organizationId = process.env.KILO_ORG_ID;

const models = await fetchKiloModels({ token, organizationId });
console.log(JSON.stringify(models, null, 2));
