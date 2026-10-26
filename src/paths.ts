export const appBase = new URL("./", document.baseURI);
export const libraryCachePrefix =
  "kuroi-library-" + appBase.pathname.replace(/\W/g, "_") + "-";
