import { defaultEveAuth, eveChannel } from "eve/channels/eve";
import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";

const devUserAuth = async () => {
  if (process.env.NODE_ENV === "production") return null;

  return {
    authenticator: "local-dev-1",
    issuer: "local-dev-1",
    principalType: "user" as const,
    principalId: "local-dev-user-1",
    subject: "local-dev-user-1",
    attributes: {
      name: "Local Dev User 1",
      email: "local-dev-1@example.com",
    },
  };
};

export default eveChannel({
  auth: [
    devUserAuth,
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // Lets the eve TUI and your Vercel deployments reach the deployed agent.
    vercelOidc(),
    // This placeholder will not allow browser requests in production.
    // Replace it with your app's auth provider, like Auth.js or Clerk,
    // or use none() for a public demo.
    placeholderAuth(),
  ],
  uploadPolicy: "disabled",
  // onMessage: async (ctx, message) => {
  //   console.log(ctx, message);

  //   return {
  //     auth: defaultEveAuth(ctx),
  //   };
  // },
});
