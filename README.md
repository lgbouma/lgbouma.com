A simple hugo-generated portfolio website.

The template is `simple-hugo-theme`.

The hosting process is described [here](https://gohugo.io/hosting-and-deployment/hosting-on-github/)

Once the appropriate `origin` and `gh-pages` branches have been established
(appropriate meaning make gh-pages as an empty orphan branch, and then put the
"public" folder into its own branch with the worktree feature), you can test
out changes with

```
hugo server -D
```

and push changes using the `autodeploy.sh` script.

Some custom html shortcodes include embedding audio and expanding text tabs.

The only slightly manual html edit at moment is the tab text title block
at /layouts/partials/head.html.
