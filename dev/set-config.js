// Writes settings to the extension storage (like the options page) and notifies the extension.
// Replace CONFIG with a JSON object, e.g. {"fontScale":1.35}.
const { ExtensionStorageIDB } = ChromeUtils.importESModule("resource://gre/modules/ExtensionStorageIDB.sys.mjs");
const extension = WebExtensionPolicy.getByID("heron@essia").extension;
const db = await ExtensionStorageIDB.open(ExtensionStorageIDB.getStoragePrincipal(extension));
const { config: old = {} } = await db.get("config");
const config = { ...old, ...CONFIG };
const changes = await db.set({ config });
ExtensionStorageIDB.notifyListeners(extension.id, changes);
await new Promise(r => setTimeout(r, 1500));
return config;
