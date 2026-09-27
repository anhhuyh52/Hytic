import { beforeEach, describe, expect, it } from "vitest";
import { openLegacyRootDirectory, resetStorageDirectoryCaches } from "./ProjectDirectory";
import { resetProjectStore } from "./projectStore";
import { bootOpfs, listProjectSummaries } from "./storageBridge";
import { initMemoryFs, setStorageAccount, storageContext } from "./storageWriter";

beforeEach(() => {
  storageContext.handle = null;
  storageContext.getWriteAccess = null;
  storageContext.write = null;
  storageContext.dir = null;
  initMemoryFs();
  setStorageAccount(null);
  resetStorageDirectoryCaches();
  resetProjectStore();
});

describe("OPFS account isolation", () => {
  it("assigns the legacy workspace to the first account only", async () => {
    setStorageAccount("account-a");
    resetStorageDirectoryCaches();
    resetProjectStore();

    const legacyRoot = await openLegacyRootDirectory();
    const projects = (await legacyRoot.getDirectory("projects", true))!;
    const project = (await projects.getDirectory("legacy-project", true))!;
    await project.getDirectory("user-media", true);
    await project.saveFile("state.json", {
      id: "legacy-project",
      name: "Legacy Project",
      activeUserMedia: "",
    });
    await projects.saveFile("active.txt", "legacy-project");

    await bootOpfs("account-a");
    await expect(listProjectSummaries()).resolves.toEqual([
      expect.objectContaining({ id: "legacy-project", name: "Legacy Project" }),
    ]);

    await bootOpfs("account-b");
    const accountBProjects = await listProjectSummaries();
    expect(accountBProjects).toHaveLength(1);
    expect(accountBProjects[0]).toMatchObject({ name: "Default Project" });
    expect(accountBProjects[0]?.id).not.toBe("legacy-project");

    await bootOpfs("account-a");
    await expect(listProjectSummaries()).resolves.toEqual([
      expect.objectContaining({ id: "legacy-project", name: "Legacy Project" }),
    ]);
  });
});
