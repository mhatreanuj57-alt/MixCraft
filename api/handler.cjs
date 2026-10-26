let handlerPromise;

module.exports = async function handler(request, response) {
  handlerPromise ??= import("../apps/api/dist/vercel-handler.js").then(
    ({ default: appHandler }) => appHandler,
  );

  return (await handlerPromise)(request, response);
};
