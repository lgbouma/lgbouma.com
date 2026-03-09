### TESS All-Sky Rotation Survey Interactive Visuals

In [Boyle, Bouma & Mann (2026)](http://arxiv.org/abs/2603.05586) we used TESS
images from 2018-2025 to search for photometric rotation periods of stars
within 500 pc.

This work yielded catalogs of 944,056 stars with detected periods, as well as
light curves for 7,481,412 stars in the parent sample (_d_<500pc, _T_<16).
Each star was observed by TESS for a median of four sectors, and so the
latter dataset includes 39,061,674 sector-level light curves.  We packaged each
light curve with a vetting plot to enable manual inspection.

The light curves and vetting plots are a [HLSP at
MAST](https://archive.stsci.edu/hlsp/tars) that will become active following
peer review.
The rotation period catalogs and associated code are on
[Zenodo](https://zenodo.org/records/18342591).
This page links to two visualizations that help explore the data.

---

### [Galactic XYZ positions](/apps/tars_xyz/)
This webapp enables exploring the locations of stars with detected rotation
periods, including by using a 1-d projection of their velocities.

[![xyz](/images/tars_xyz.png)](/apps/tars_xyz/)

---

### [TARS Vetting Explorer](http://lcviz.lgbouma.com:8056/)

This webapp enables exploring the vetting plots for user-specified stars, for
instance in P<sub>rot</sub> vs T<sub>eff</sub>, M<sub>G,0</sub> vs
(BP-RP)<sub>0</sub>, or by TICID.

[![vetting](/images/tars_lcviz.jpg)](http://lcviz.lgbouma.com:8056/)
