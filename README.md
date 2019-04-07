a website for portfolio showin

it runs on hugo. the template is simple-hugo-theme/

the hosting process is described [here](https://gohugo.io/hosting-and-deployment/hosting-on-github/)

once the appropriate `origin` and `gh-pages` branches have been established
(appropriate meaning make gh-pages as an empty orphan brnch, and then put the
"public" folder into its own branch with the worktree feature),

testing out changes works with
```
hugo server -D
```

pushing changes is then as simple as:
```
hugo
cd public && git add --all && git commit -m "Publishing to gh-pages" && cd ..
git push origin gh-pages
```

this is put into the `deploy.sh` scripts
