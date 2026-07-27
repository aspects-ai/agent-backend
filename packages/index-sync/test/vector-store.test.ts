import { InMemoryVectorStore } from "../src/index.js";

import { runVectorStoreConformance } from "./support/vector-conformance.js";

runVectorStoreConformance("in-memory", () => ({ store: new InMemoryVectorStore() }));
