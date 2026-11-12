-- Curated, verified exam reference; shared course-library semantics unchanged.
INSERT INTO public.resources (id,title,course,subject,doc_type,source_filename,page_count,char_count,chunk_count,status)
VALUES ('93d1cfc4-bcee-4284-a0f1-02f163e56a5a','Calculus Exam Preparation — Checked English Reference','Calculus','Mathematics','lecture notes','แนวไฟนอลแคล.pdf',4,4292,10,'keyword-only')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.resource_chunks (resource_id,chunk_index,page,section,content)
SELECT v.resource_id::uuid,v.chunk_index,v.page,v.section,v.content FROM (VALUES
('93d1cfc4-bcee-4284-a0f1-02f163e56a5a',0,1,'Source and accuracy','Checked English reference for uploaded calculus exam preparation. Source PDF: /__l5e/assets-v1/7549b7d7-2f84-4a30-961d-a6f98f5e4e20/calculus-exam-reference.pdf. Handwritten workings are incomplete or erroneous in places; use these independently verified results only when the actual question matches.'),
('93d1cfc4-bcee-4284-a0f1-02f163e56a5a',1,2,'Page 2 — multivariable chain rule and Jacobian matrices','Use D(g composed with f)(p) = Dg(f(p)) Df(p). Rows represent output components, columns input variables. Put input partial-derivative column labels above the brackets and output-component row labels outside the left bracket when needed. Multiply rows by columns; do not transpose.'),
('93d1cfc4-bcee-4284-a0f1-02f163e56a5a',2,2,'Page 2 — multivariable chain rule and Jacobian matrices','Example 1: f(u,v)=(ln u,uv,u+2v^2), g(x,y,z)=(arctan(xz),1+x-2y), p=(1,0).
Df=[[1/u,0],[v,u],[1,4v]], Df(1,0)=[[1,0],[0,1],[1,0]], f(1,0)=(0,0,1).
Dg=[[z/(1+x^2 z^2),0,x/(1+x^2 z^2)],[1,-2,0]]. Dg(0,0,1)=[[1,0,0],[1,-2,0]]. Product=[[1,0],[1,-2]].'),
('93d1cfc4-bcee-4284-a0f1-02f163e56a5a',3,2,'Page 2 — multivariable chain rule and Jacobian matrices','Example 2: f(u,v)=(u^2 v,sin u,v+3), g(x,y,z)=(x,y^2,yz), p=(0,1). The source leaves solution matrices blank: do not copy example 1''s numbers into them.
Df=[[2uv,u^2],[cos u,0],[0,1]], Df(0,1)=[[0,0],[1,0],[0,1]], f(0,1)=(0,0,4).
Dg=[[1,0,0],[0,2y,0],[0,z,y]], Dg(0,0,4)=[[1,0,0],[0,0,0],[0,4,0]]. Product=[[0,0],[0,0],[4,0]].'),
('93d1cfc4-bcee-4284-a0f1-02f163e56a5a',4,2,'Page 2 — multivariable chain rule and Jacobian matrices','Example 3: f(u,v)=(u^2+v,uv^2), g(x,y)=(x-y,2xy), p=(1,2).
Df=[[2u,1],[v^2,2uv]], Df(1,2)=[[2,1],[4,4]], f(1,2)=(3,4).
Dg=[[1,-1],[2y,2x]], Dg(3,4)=[[1,-1],[8,6]]. Product=[[-2,-3],[40,32]].'),
('93d1cfc4-bcee-4284-a0f1-02f163e56a5a',5,3,'Page 3 — scalar line integral, Green theorem, work','Scalar line integral of (2x+y) ds on x^2+y^2+z^2=1, x=y, first octant.
r(t)=(t,t,sqrt(1-2t^2)), 0<=t<=1/sqrt(2). r''(t)=(1,1,-2t/sqrt(1-2t^2)); ds=sqrt(2/(1-2t^2)) dt.
Integral=3 sqrt(2) integral_0^(1/sqrt(2)) t/sqrt(1-2t^2) dt. Substitute w=1-2t^2, dw=-4t dt, bounds 1 to 0. Answer=3 sqrt(2)/2. The endpoint singularity is integrable. Alternatively r(theta)=(sin(theta)/sqrt(2),sin(theta)/sqrt(2),cos(theta)), 0<=theta<=pi/2, gives speed 1.
Sketch if needed: label x,y,z axes, draw unit sphere and plane x=y, highlight first-octant quarter-circle between (0,0,1) and (1/sqrt(2),1/sqrt(2),0).'),
('93d1cfc4-bcee-4284-a0f1-02f163e56a5a',6,3,'Page 3 — scalar line integral, Green theorem, work','Green theorem for integral (2xy-y) dx+2x^2 dy around 2x^2+y^2=1. Q_x-P_y=4x-(2x-1)=2x+1.
Assuming positive counterclockwise orientation, bounds -1<=y<=1 and -sqrt((1-y^2)/2)<=x<=sqrt((1-y^2)/2). Odd term integrates to zero. Answer=ellipse area=pi/sqrt(2). Reverse sign for clockwise orientation; the source does not clearly specify orientation.
Sketch: x horizontal, y vertical, center (0,0), x intercepts (+/-1/sqrt(2),0), y intercepts (0,+/-1); join a taller vertical ellipse, shade its interior, add the orientation arrow only under the stated convention.'),
('93d1cfc4-bcee-4284-a0f1-02f163e56a5a',7,3,'Page 3 — scalar line integral, Green theorem, work','Work: P=3x^2-2xy+y^2, Q=2xy-x^2-3y^2, from (-1,2) to (1,-2). P_y=-2x+2y=Q_x. Potential Phi=x^3-x^2 y+xy^2-y^3. Phi(1,-2)=15, Phi(-1,2)=-15. Answer=30, not the crossed-out 8/3.
Direct verification: r(t)=(-1+2t,2-4t), 0<=t<=1; r''=(2,-4). F(r) dot r''=360t^2-360t+90. Integral=120-180+90=30. Preserve squared terms during substitution.'),
('93d1cfc4-bcee-4284-a0f1-02f163e56a5a',8,4,'Page 4 — surface area and Gauss theorem','Surface area z=2xy over x^2+y^2<=1. z_x=2y, z_y=2x; dS=sqrt(1+4x^2+4y^2) dA. Polar bounds 0<=r<=1, 0<=theta<=2pi and dA=r dr dtheta.
Area=integral_0^(2pi) integral_0^1 sqrt(1+4r^2) r dr dtheta. w=1+4r^2, dw=8r dr, bounds 1 and 5. Inner result=(5sqrt(5)-1)/12; total area=pi(5sqrt(5)-1)/6. Retain this result despite the handwritten cross mark.
Sketch disk centered at origin with unit intercepts on both axes; shade disk as the projection region.'),
('93d1cfc4-bcee-4284-a0f1-02f163e56a5a',9,4,'Page 4 — surface area and Gauss theorem','Outward flux of F=(x^2,y^2,z^2) through lateral cone z=sqrt(x^2+y^2), 0<z<1. Gauss requires closing the top with disk z=1. Solid bounds 0<=z<=1, 0<=r<=z, 0<=theta<=2pi; dV=r dr dtheta dz. Divergence=2x+2y+2z. Closed flux=integral_0^1 integral_0^(2pi) integral_0^z (2r cos(theta)+2r sin(theta)+2z) r dr dtheta dz=pi/2.
Top cap outward flux=integral_disk 1 dA=pi. Lateral outward flux=pi/2-pi=-pi/2. If normal is inward, reverse sign. Do not use the incorrect 0<=z<=r solid bounds for the interior of this truncated cone.
Sketch cone vertex (0,0,0), vertical z axis, top circle radius 1 at z=1; mark height 1 and radius 1. Show cap separately and outward normal arrows when applying Gauss.')
) AS v(resource_id,chunk_index,page,section,content)
WHERE NOT EXISTS (SELECT 1 FROM public.resource_chunks c WHERE c.resource_id=v.resource_id::uuid AND c.chunk_index=v.chunk_index);
