let gfx_loadBufferObjects = (verts, tris, norms) => {
    let result = {t:tris.length};

    result.v = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, result.v);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    result.i = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, result.i);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tris, gl.STATIC_DRAW);

    if (norms) {
        result.n = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, result.n);
        gl.bufferData(gl.ARRAY_BUFFER, norms, gl.STATIC_DRAW);
    }

    return result;
};

let gfx_flatShadeAndloadBufferObjects = (verts, tris) => {
    let newVerts = [];
    let newTris = [];
    let normals = [];
    let i = 0;

    tris.forEach((t,i) => {
        newVerts=newVerts.concat(verts[3*t],verts[3*t+1],verts[3*t+2]);
        newTris.push(i);
    });

    for (; i < newVerts.length; i += 9) {
        let a = [newVerts[i+0], newVerts[i+1], newVerts[i+2]];
        let b = [newVerts[i+3], newVerts[i+4], newVerts[i+5]];
        let c = [newVerts[i+6], newVerts[i+7], newVerts[i+8]];

        let ab = vec3_minus(b, a);
        let ac = vec3_minus(c, a);
        let normal = vec3_normalize(vec3_cross(ab, ac));

        normals = normals.concat([
            normal[0],normal[1],normal[2],
            normal[0],normal[1],normal[2],
            normal[0],normal[1],normal[2]
        ]);
    }
    
    return gfx_loadBufferObjects(
        new Float32Array(verts), 
        new Uint16Array(tris),
        new Float32Array(normals)
    );
};

let gfx_loadBufferObjectsFromModelFile = (arrayBuffer, mode16) => {
    let bytes = new Uint8Array(arrayBuffer);
    let scaleX = bytes[0] / 256 * 8;
    let scaleY = bytes[1] / 256 * 8;
    let scaleZ = bytes[2] / 256 * 8;
    let originX = bytes[3] / 256 * scaleX;
    let originY = bytes[4] / 256 * scaleY;
    let originZ = bytes[5] / 256 * scaleZ;
    let numVerts = bytes[6] + 256*bytes[7];
    let triOffset = 8 + 3*numVerts;

    let verts = [];
    let vertSub = bytes.subarray(8, triOffset);
    for (let i = 0; i < vertSub.length; i += 3) {
        verts.push(vertSub[i  ] / 256 * scaleX - originX);
        verts.push(vertSub[i+1] / 256 * scaleY - originY);
        verts.push(vertSub[i+2] / 256 * scaleZ - originZ);
    }
    
    let tris = new Uint16Array(mode16 ? bytes.buffer.slice(triOffset) : bytes.subarray(triOffset));

    return gfx_loadBufferObjects(new Float32Array(verts), tris);
};

let gfx_loadModel = s =>
    fetch(s)
        .then(response => response.arrayBuffer())
        .then(buffer => gfx_loadBufferObjectsFromModelFile(buffer, s.endsWith('16')));

if (__DEBUG) {
    var showHTMLShaderError = (kind, log, code) => {
        let codeWithNumbers = code.split('\n').map((x,i) => `${i+2}:  ${x}`).join('<br />');

        document.body.innerHTML = `<h1>Error in ${kind} shader:</h1>
            <code>${log.replace(/\n/g, '<br/>')}</code><br><br>
            <code>${codeWithNumbers}</code>`;

        throw new Error('Error compiling shader');
    };
}

let gfx_compileProgram = (vert, frag) => {
    let vertShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertShader, vert);
    gl.compileShader(vertShader);

    if (__DEBUG) {
        let vertLog = gl.getShaderInfoLog(vertShader);
        if (vertLog === null || vertLog.length > 0) showHTMLShaderError('vertex', vertLog, vert);
    }

    let fragShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragShader, 'precision highp float;'+frag);
    gl.compileShader(fragShader);

    if (__DEBUG) {
        let fragLog = gl.getShaderInfoLog(fragShader);
        if (fragLog === null || fragLog.length > 0) showHTMLShaderError('fragment', fragLog, frag);
    }

    let prog = gl.createProgram();
    gl.attachShader(prog, vertShader);
    gl.attachShader(prog, fragShader);
    gl.linkProgram(prog);
    return prog;
};

let gfx_createBufferRenderer = () => {
    let vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,1,-1,-1,1,-1,1,-1,1,1,-1,1]), gl.STATIC_DRAW);

    return (shader, texture) => {
        gl.useProgram(shader);

        if (texture) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.uniform1i(gl.getUniformLocation(shader, "u_tex"), 0);
        }

        gl.uniform2f(gl.getUniformLocation(shader, 'u_resolution'), C.width, C.height);

        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        let posLoc = gl.getAttribLocation(shader, "a_position");
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
};

let gfx_createFrameBufferTexture = () => {
    let framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        
    let texture = gl.createTexture();
    let depth = gl.createRenderbuffer();

    let result = {
        f: framebuffer,
        t: texture,
        r(width, height) { // resize()
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, width, height, 0, gl.RGB, gl.UNSIGNED_BYTE, null);

            gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
        }
    };

    result.r(1,1);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);  
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0); 
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);

    return result;
};

let gfx_drawShaderToTexture = (shader, widthHeight) => {
    let frameBuffer = gfx_createFrameBufferTexture();
    frameBuffer.r(widthHeight, widthHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuffer.f);
    gl.viewport(0, 0, widthHeight, widthHeight);
    gfx_createBufferRenderer()(shader);
    return frameBuffer.t;
};
