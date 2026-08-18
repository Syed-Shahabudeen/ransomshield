import React, { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Icosahedron, MeshDistortMaterial } from "@react-three/drei";

function RotatingShield({ status }) {
  const meshRef = useRef();

  // Adjust parameters based on attack / recovery / protected status
  const getColor = () => {
    if (status === "under_attack") return "#FF3B4E";
    if (status === "recovering" || status === "recovered") return "#FFB020";
    return "#19E3C2";
  };

  const getSpeed = () => {
    if (status === "under_attack") return 3.5;
    if (status === "recovering" || status === "recovered") return 1.5;
    return 0.5;
  };

  const getDistort = () => {
    if (status === "under_attack") return 0.5;
    if (status === "recovering" || status === "recovered") return 0.25;
    return 0.15;
  };

  useFrame((state, delta) => {
    if (meshRef.current) {
      const speed = getSpeed();
      meshRef.current.rotation.y += delta * speed * 0.5;
      meshRef.current.rotation.x += delta * speed * 0.2;
    }
  });

  const shieldColor = getColor();

  return (
    <mesh ref={meshRef}>
      {/* Hexagonal-ish structure using icosahedron */}
      <Icosahedron args={[1.5, 1]} scale={1.1}>
        <meshBasicMaterial 
          color={shieldColor} 
          wireframe 
          transparent 
          opacity={0.15} 
        />
      </Icosahedron>
      
      <Icosahedron args={[1.2, 2]}>
        <MeshDistortMaterial
          color={shieldColor}
          emissive={shieldColor}
          emissiveIntensity={status === "under_attack" ? 2.5 : 1.2}
          roughness={0.1}
          metalness={0.8}
          distort={getDistort()}
          speed={getSpeed()}
        />
      </Icosahedron>
    </mesh>
  );
}

export default function ShieldHero({ status }) {
  return (
    <div style={{
      width: "100%",
      height: "260px",
      position: "relative",
      background: "radial-gradient(circle, rgba(13,18,31,0.5) 0%, transparent 70%)",
      borderRadius: "8px",
      overflow: "hidden"
    }}>
      <Canvas camera={{ position: [0, 0, 4.5], fov: 45 }}>
        <ambientLight intensity={0.4} />
        <pointLight position={[10, 10, 10]} intensity={1.5} />
        <directionalLight position={[-5, 5, -5]} intensity={0.5} />
        <RotatingShield status={status} />
      </Canvas>
      <div style={{
        position: "absolute",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        fontSize: "10px",
        fontFamily: "'JetBrains Mono', monospace",
        color: status === "under_attack" ? "#FF3B4E" : "#19E3C2",
        letterSpacing: "0.15em",
        pointerEvents: "none",
        textTransform: "uppercase"
      }}>
        {status === "under_attack" ? "Decoy Barrier: Compromised" : "Active Cryptographic Aegis Active"}
      </div>
    </div>
  );
}
