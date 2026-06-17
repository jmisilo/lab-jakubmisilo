# Application/Domain Layer

`app` directory has a lot of purposes. The main one is being the application router, as it's defined by `Next.js` framework. Another purpose is to store the actual application/domain related components and logic. That's why application and domain layers are coupled together in this directory. Additionally boundaries of these two are really blurry. Main folder structure is coupled with the routing schema, however internal content of the main directory is supposed to be domain related. There are some strictly defined rules, that we should follow in the project, in favour to keep each sub-domain organized:

- Sub-domain's components, utilities, hooks, etc. should be stored in a separate directory, which name starts with `_` (underscore). For example, `_components`, `_hooks`, `_utils`, etc.
- Most of the reusable components across sub-domains should be stored in the root of the sub-domain.
- Child sub-domain can inherit (import) components, utilities, hooks, etc. from the parent sub-domain.
- Parent sub-domain CANNOT import components, utilities, hooks, etc. from the child sub-domain.

[Next.js routing explained](https://nextjs.org/docs/app/building-your-application/routing).
