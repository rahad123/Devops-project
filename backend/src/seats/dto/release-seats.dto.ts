import { IsArray, IsString, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReleaseSeatsDto {
  @ApiProperty({ example: ['1A', '1B'], description: 'Seat numbers to release' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  seatNumbers: string[];

  @ApiProperty({ description: 'User ID who holds the seats' })
  @IsString()
  userId: string;
}
