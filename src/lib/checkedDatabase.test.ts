import { it, expect } from "vitest";
import { checkedDatabase } from "./checkedDatabase";
it("never converts a failed read or write into an empty success", async () => {
  const error = new Error("Database unavailable");
  await expect(checkedDatabase(Promise.resolve({data:null,error}))).rejects.toThrow("Database unavailable");
  await expect(checkedDatabase(Promise.resolve({data:[],error:null}))).resolves.toMatchObject({data:[]});
});
