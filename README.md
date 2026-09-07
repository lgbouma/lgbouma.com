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

Tab text / search-result titles are built in
/themes/simple-hugo-theme/layouts/partials/head.html from the `authorName` and
`affiliation` params in config.toml.  The home page reads
"<authorName> | <affiliation>"; other pages read "<page> | <authorName>", where
`<page>` comes from the front-matter title, or from the filename when a content
file has no front matter.
